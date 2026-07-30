import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	createOctaneCompiler: vi.fn(),
	transform: vi.fn(),
}));

vi.mock('octane/compiler/bundler', () => ({
	createOctaneCompiler: mocks.createOctaneCompiler,
}));

import octaneNextLoader from '../src/loader.js';

interface LoaderResult {
	error: Error | null;
	content?: string | Buffer;
	map?: unknown;
}

function runLoader({
	options = { root: '/project', environment: 'client', dev: true, profile: false },
	resource = '/project/app/Counter.tsx',
	source = `
'use client';
'use octane';
import { useState } from 'octane';
export function Counter() {
	const [count] = useState(0);
	return <button>{count}</button>;
}
export const useCounterLabel = () => 'counter';`,
}: {
	options?: Record<string, unknown>;
	resource?: string;
	source?: string;
} = {}) {
	let result: LoaderResult | undefined;
	const dependencies: string[] = [];
	const missingDependencies: string[] = [];
	const context = {
		resource,
		resourcePath: resource.split('?')[0],
		rootContext: '/project',
		sourceMap: true,
		cacheable: vi.fn(),
		getOptions: () => options,
		addDependency: (dependency: string) => dependencies.push(dependency),
		addMissingDependency: (dependency: string) => missingDependencies.push(dependency),
		emitWarning: vi.fn(),
		callback: (error: Error | null, content?: string | Buffer, map?: unknown) => {
			result = { error, content, map };
		},
	};
	octaneNextLoader.call(context, source);
	return { context, dependencies, missingDependencies, result: result! };
}

describe('@octanejs/next Turbopack loader', () => {
	beforeEach(() => {
		mocks.transform.mockReset();
		mocks.createOctaneCompiler.mockReset().mockReturnValue({
			transform: mocks.transform,
		});
	});

	it('requests a React-hosted export boundary for Octane client references', () => {
		mocks.transform.mockReturnValue({
			code: `'use client'; export function Counter() {}`,
			map: null,
			kind: 'compile',
			dependencies: [],
			missingDependencies: [],
		});
		const output = runLoader();
		expect(output.result.error).toBeNull();
		expect(mocks.createOctaneCompiler).toHaveBeenCalledOnce();
		expect(mocks.transform).toHaveBeenCalledWith(
			expect.stringMatching(/^'use no memo';[\s\S]*'use client'/),
			'/project/app/Counter.tsx',
			expect.objectContaining({
				environment: 'client',
				dev: true,
				reactHostedBoundary: {
					compatModule: '@octanejs/next/compat',
				},
			}),
		);
		expect(output.result.content).toBe(`'use client'; export function Counter() {}`);
	});

	it('compiles the server copy of a client boundary with the same hosted export contract', () => {
		mocks.transform.mockReturnValue({
			code: 'export const Counter = compiled;',
			map: { version: 3, sources: ['Counter.tsrx'], names: [], mappings: 'AAAA' },
			kind: 'compile',
			dependencies: ['/project/package.json'],
			missingDependencies: ['/project/missing.json'],
		});
		const output = runLoader({
			options: {
				root: '/project',
				environment: 'server',
				dev: true,
				profile: true,
			},
		});

		expect(mocks.createOctaneCompiler).toHaveBeenCalledWith({
			root: '/project',
			profile: false,
			requireDirective: false,
			warn: expect.any(Function),
		});
		expect(mocks.transform).toHaveBeenCalledWith(
			expect.stringMatching(/^'use no memo';[\s\S]*'use client'/),
			'/project/app/Counter.tsx',
			{
				environment: 'server',
				hmr: false,
				dev: false,
				profile: false,
				migrateReactImports: true,
				reactHostedBoundary: {
					compatModule: '@octanejs/next/compat',
				},
			},
		);
		expect(output.dependencies).toEqual(['/project/package.json']);
		expect(output.missingDependencies).toEqual(['/project/missing.json']);
		expect(output.result).toMatchObject({
			error: null,
			content: 'export const Counter = compiled;',
		});
	});

	it('compiles TSRX without a client directive directly', () => {
		mocks.transform.mockReturnValue({
			code: 'export const Value = compiled;',
			map: null,
			kind: 'compile',
			dependencies: [],
			missingDependencies: [],
		});
		const output = runLoader({
			resource: '/project/app/Value.tsrx',
			source: `export function Value() @{ <span /> }`,
		});
		expect(mocks.transform).toHaveBeenCalledOnce();
		expect(mocks.transform).toHaveBeenCalledWith(expect.any(String), '/project/app/Value.tsrx', {
			environment: 'client',
			hmr: false,
			dev: true,
			profile: false,
		});
		expect(output.result.content).toBe('export const Value = compiled;');
	});

	it('rejects export-star client boundaries with an actionable diagnostic', () => {
		const output = runLoader({
			source: `'use client'; 'use octane'; export * from './shared.tsrx';`,
		});
		expect(output.result.error).toMatchObject({
			code: 'OCTANE_NEXT_EXPORT_STAR_UNSUPPORTED',
			filename: '/project/app/Counter.tsx',
		});
		expect(output.result.error?.message).toContain('local wrapper component');
	});

	it('rejects imported component exports that cannot be classified safely', () => {
		const output = runLoader({
			source: `'use client'; 'use octane'; import { Card } from './Card'; export { Card };`,
		});
		expect(output.result.error).toMatchObject({
			code: 'OCTANE_NEXT_IMPORTED_COMPONENT_EXPORT_UNSUPPORTED',
			filename: '/project/app/Counter.tsx',
		});
		expect(output.result.error?.message).toContain('local wrapper component');
		expect(mocks.createOctaneCompiler).not.toHaveBeenCalled();
	});

	it('rejects direct TSRX client boundaries before Turbopack creates an unresolvable proxy', () => {
		const output = runLoader({
			resource: '/project/app/Counter.tsrx',
			source: `'use client'; export function Counter() @{ <button /> }`,
		});
		expect(output.result.error).toMatchObject({
			code: 'OCTANE_NEXT_TSRX_CLIENT_BOUNDARY_UNSUPPORTED',
			filename: '/project/app/Counter.tsrx',
		});
		expect(output.result.error?.message).toContain('"use octane"');
		expect(mocks.createOctaneCompiler).not.toHaveBeenCalled();
	});

	it('passes through a regex prefilter false positive without explicit Octane ownership', () => {
		const source = `const documentation = 'use octane'; export function helper() { return null; }`;
		const output = runLoader({
			source,
		});
		expect(output.result).toMatchObject({ error: null, content: source });
		expect(mocks.createOctaneCompiler).not.toHaveBeenCalled();
	});

	it('passes through an automatic-mode use-client prefilter false positive', () => {
		const source = `const documentation = 'use client'; export function helper() { return null; }`;
		const output = runLoader({
			options: {
				root: '/project',
				environment: 'client',
				dev: true,
				profile: false,
				clientComponents: 'all',
			},
			source,
		});
		expect(output.result).toMatchObject({ error: null, content: source });
		expect(mocks.createOctaneCompiler).not.toHaveBeenCalled();
	});

	it('compiles a use-octane transitive module without creating a hosted boundary', () => {
		mocks.transform.mockReturnValue({
			code: `export function Counter() {}`,
			map: null,
			kind: 'compile',
			dependencies: [],
			missingDependencies: [],
		});
		const output = runLoader({
			source: `'use octane'; export function Counter() { return null; }`,
		});
		expect(output.result.error).toBeNull();
		expect(mocks.transform).toHaveBeenCalledWith(
			expect.any(String),
			'/project/app/Counter.tsx',
			expect.objectContaining({
				migrateReactImports: true,
			}),
		);
		expect(mocks.transform.mock.calls[0][2]).not.toHaveProperty('reactHostedBoundary');
	});

	it('automatically migrates an ordinary use-client boundary in all mode', () => {
		mocks.transform.mockReturnValue({
			code: `'use client'; export function Counter() {}`,
			map: null,
			kind: 'compile',
			dependencies: [],
			missingDependencies: [],
		});
		const output = runLoader({
			options: {
				root: '/project',
				environment: 'client',
				dev: true,
				profile: false,
				clientComponents: 'all',
			},
			source: `'use client'; import { useState } from 'react'; export function Counter() { const [count] = useState(0); return <button>{count}</button>; }`,
		});
		expect(output.result.error).toBeNull();
		expect(mocks.transform).toHaveBeenCalledWith(
			expect.any(String),
			'/project/app/Counter.tsx',
			expect.objectContaining({
				migrateReactImports: true,
				reactHostedBoundary: {
					compatModule: '@octanejs/next/compat',
				},
			}),
		);
	});

	it('automatically migrates an ordinary use-client boundary by default', () => {
		mocks.transform.mockReturnValue({
			code: `'use client'; export function Counter() {}`,
			map: null,
			kind: 'compile',
			dependencies: [],
			missingDependencies: [],
		});
		const output = runLoader({
			source: `'use client'; import { useState } from 'react'; export function Counter() { const [count] = useState(0); return <button>{count}</button>; }`,
		});
		expect(output.result.error).toBeNull();
		expect(mocks.transform).toHaveBeenCalledWith(
			expect.any(String),
			'/project/app/Counter.tsx',
			expect.objectContaining({
				migrateReactImports: true,
				reactHostedBoundary: {
					compatModule: '@octanejs/next/compat',
				},
			}),
		);
	});

	it('migrates a boundary that imports an explicitly Octane-owned child', () => {
		const root = mkdtempSync(join(tmpdir(), 'octane-next-owned-child-'));
		const resource = join(root, 'Parent.tsx');
		const child = join(root, 'Child.tsx');
		writeFileSync(child, `'use octane'; export function Child() { return <span />; }`);
		try {
			mocks.transform.mockReturnValue({
				code: `'use client'; export function Parent() {}`,
				map: null,
				kind: 'compile',
				dependencies: [],
				missingDependencies: [],
			});
			const output = runLoader({
				resource,
				source: `'use client'; import { Child } from './Child'; export function Parent() { return <Child />; }`,
			});
			expect(output.result.error).toBeNull();
			expect(mocks.transform).toHaveBeenCalledOnce();
			expect(output.dependencies).toContain(child);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	it('keeps an unsupported automatic boundary on React with a diagnostic', () => {
		const source = `'use client'; import { usePathname } from 'next/navigation'; export function Nav() { return <p>{usePathname()}</p>; }`;
		const output = runLoader({
			options: {
				root: '/project',
				environment: 'client',
				dev: true,
				profile: false,
				clientComponents: 'all',
				diagnostics: true,
			},
			source,
		});
		expect(output.result).toMatchObject({ error: null, content: source });
		expect(output.context.emitWarning).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('next/navigation'),
			}),
		);
		expect(mocks.createOctaneCompiler).not.toHaveBeenCalled();
	});

	it('keeps a children-owning automatic boundary on React', () => {
		const source = `'use client'; export function Shell({ children }) { return <main>{children}</main>; }`;
		const output = runLoader({
			options: {
				root: '/project',
				environment: 'client',
				dev: true,
				profile: false,
				clientComponents: 'all',
				diagnostics: true,
			},
			source,
		});
		expect(output.result).toMatchObject({ error: null, content: source });
		expect(output.context.emitWarning).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('children'),
			}),
		);
		expect(mocks.createOctaneCompiler).not.toHaveBeenCalled();
	});

	it('keeps a React ViewTransition boundary on React in automatic mode', () => {
		const source = `'use client'; import { ViewTransition as Transition } from 'react'; export function Photo() { return <Transition name="photo"><img alt="" /></Transition>; }`;
		const output = runLoader({
			options: {
				root: '/project',
				environment: 'client',
				dev: true,
				profile: false,
				clientComponents: 'all',
				diagnostics: true,
			},
			source,
		});
		expect(output.result).toMatchObject({ error: null, content: source });
		expect(output.context.emitWarning).toHaveBeenCalledWith(
			expect.objectContaining({
				message: expect.stringContaining('ViewTransition'),
			}),
		);
		expect(mocks.createOctaneCompiler).not.toHaveBeenCalled();
	});

	it('lets explicit Octane ownership override conservative external-import planning', () => {
		mocks.transform.mockReturnValue({
			code: `'use client'; export function Nav() {}`,
			map: null,
			kind: 'compile',
			dependencies: [],
			missingDependencies: [],
		});
		const output = runLoader({
			source: `'use client'; 'use octane'; import { usePathname } from 'next/navigation'; export function Nav() { return <p>{usePathname()}</p>; }`,
		});
		expect(output.result.error).toBeNull();
		expect(mocks.transform).toHaveBeenCalledOnce();
	});

	it('lets explicit Octane ownership opt into isolated ViewTransition semantics', () => {
		mocks.transform.mockReturnValue({
			code: `'use client'; export function Photo() {}`,
			map: null,
			kind: 'compile',
			dependencies: [],
			missingDependencies: [],
		});
		const output = runLoader({
			source: `'use client'; 'use octane'; import { ViewTransition } from 'react'; export function Photo() { return <ViewTransition><img alt="" /></ViewTransition>; }`,
		});
		expect(output.result.error).toBeNull();
		expect(mocks.transform).toHaveBeenCalledOnce();
	});

	it('migrates a use-octane transitive module without adding a hosted facade in all mode', () => {
		mocks.transform.mockReturnValue({
			code: `export function ImportedChild() {}`,
			map: null,
			kind: 'compile',
			dependencies: [],
			missingDependencies: [],
		});
		const output = runLoader({
			options: {
				root: '/project',
				environment: 'server',
				dev: false,
				profile: false,
				clientComponents: 'all',
			},
			source: `'use octane'; import { useMemo } from 'react'; export function ImportedChild() { return <span />; }`,
		});
		expect(output.result.error).toBeNull();
		expect(mocks.transform).toHaveBeenCalledWith(
			expect.any(String),
			'/project/app/Counter.tsx',
			expect.objectContaining({
				environment: 'server',
				migrateReactImports: true,
			}),
		);
		expect(mocks.transform.mock.calls[0][2]).not.toHaveProperty('reactHostedBoundary');
	});

	it('leaves a use-react escape boundary byte-identical in all mode', () => {
		const source = `'use client'; 'use react'; export function Counter() { return <button />; }`;
		const output = runLoader({
			options: {
				root: '/project',
				environment: 'client',
				dev: true,
				profile: false,
				clientComponents: 'all',
			},
			source,
		});
		expect(output.result).toMatchObject({ error: null, content: source });
		expect(mocks.createOctaneCompiler).not.toHaveBeenCalled();
	});

	it('does not apply Octane export checks to a use-react escape boundary', () => {
		const source = `'use client'; 'use react'; export * from './react-components';`;
		const output = runLoader({
			options: {
				root: '/project',
				environment: 'client',
				dev: true,
				profile: false,
				clientComponents: 'all',
			},
			source,
		});
		expect(output.result).toMatchObject({ error: null, content: source });
		expect(mocks.createOctaneCompiler).not.toHaveBeenCalled();
	});

	it('rejects conflicting use-octane and use-react ownership', () => {
		const output = runLoader({
			options: {
				root: '/project',
				environment: 'client',
				dev: true,
				profile: false,
				clientComponents: 'all',
			},
			source: `'use client'; 'use octane'; 'use react'; export function Counter() { return null; }`,
		});
		expect(output.result.error).toMatchObject({
			code: 'OCTANE_NEXT_CONFLICTING_OWNERSHIP_DIRECTIVES',
			filename: '/project/app/Counter.tsx',
		});
		expect(mocks.createOctaneCompiler).not.toHaveBeenCalled();
	});
});
