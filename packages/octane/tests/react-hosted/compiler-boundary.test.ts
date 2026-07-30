import { describe, expect, it } from 'vitest';
import { parseModule } from '@tsrx/core';
import { compile } from 'octane/compiler';

const SOURCE = `'use client';
'use octane';
import { useState } from 'octane';
import { label } from './label.ts';

export function Counter(props: { initial: number }) @{
	const [count] = useState(props.initial);
	<button>{label + count}</button>
}

function Aliased() @{
	<p>{'aliased'}</p>
}

export { Aliased as Renamed };
export const ArrowCard = () => <aside>{'arrow'}</aside>;
export const useCounterLabel = () => label;

export default function DefaultCard() @{
	<section>{'default'}</section>
}
`;

function runtimeExports(code: string) {
	const ast = parseModule(code, 'boundary.js');
	const names: string[] = [];
	for (const statement of ast.body) {
		if (statement.type === 'ExportDefaultDeclaration') {
			names.push('default');
			continue;
		}
		if (statement.type !== 'ExportNamedDeclaration') continue;
		if (statement.declaration?.type === 'FunctionDeclaration' && statement.declaration.id?.name) {
			names.push(statement.declaration.id.name);
		}
		if (statement.declaration?.type === 'VariableDeclaration') {
			for (const declaration of statement.declaration.declarations) {
				if (declaration.id.type === 'Identifier') names.push(declaration.id.name);
			}
		}
		for (const specifier of statement.specifiers) {
			if (specifier.exported.type === 'Identifier') names.push(specifier.exported.name);
		}
	}
	return { ast, names };
}

describe('React-hosted client-boundary compiler output', () => {
	for (const mode of ['client', 'server'] as const) {
		it(`exports React facades while retaining Octane implementations in ${mode} mode`, () => {
			const result = compile(SOURCE, '/project/app/Card.tsrx', {
				mode,
				hmr: false,
				reactHostedBoundary: {
					compatModule: '@fixture/octane-compat',
				},
			} as any);
			const output = runtimeExports(result.code);

			expect(output.ast.body[0]).toMatchObject({
				type: 'ExpressionStatement',
				directive: 'use client',
			});
			expect(output.ast.body[1]).toMatchObject({
				type: 'ExpressionStatement',
				directive: 'use octane',
			});
			expect(output.names.sort()).toEqual([
				'ArrowCard',
				'Counter',
				'Renamed',
				'default',
				'useCounterLabel',
			]);
			expect(result.code).toContain(`from 'react'`);
			expect(result.code).toContain(`from '@fixture/octane-compat'`);
			expect(result.code).toContain(`from './label.ts'`);
			expect(result.code).toContain('component: Counter');
			expect(result.code).toContain('component: Aliased');
			expect(result.code).toContain('component: ArrowCard');
			expect(result.code).toContain('component: DefaultCard');
		});
	}

	it('leaves ordinary compilation byte-for-byte free of hosted imports', () => {
		const result = compile(SOURCE, '/project/app/Card.tsrx', {
			hmr: false,
		});
		const explicitUndefined = compile(SOURCE, '/project/app/Card.tsrx', {
			hmr: false,
			reactHostedBoundary: undefined,
		} as any);
		expect(explicitUndefined.code).toBe(result.code);
		expect(result.code).not.toContain(`from 'react'`);
		expect(result.code).not.toContain('@fixture/octane-compat');
		expect(result.code).toContain('export const Counter');
	});

	for (const mode of ['client', 'server'] as const) {
		it(`emits native boundary registration metadata in ${mode} mode`, () => {
			const result = compile(SOURCE, '/project/app/Card.tsrx', {
				mode,
				hmr: false,
				reactHostedBoundary: {
					compatModule: '@fixture/octane-compat',
					nativeModuleId: 'app/Card.tsrx',
				},
			} as any);

			expect(result.code).toContain('registerOctaneBoundary');
			expect(result.code).toContain(`'app/Card.tsrx#Counter'`);
			expect(result.code).toContain(`'app/Card.tsrx#default'`);
			expect(result.code).toContain('__octaneNativeId');
		});
	}

	it('emits a registration-only facade for native client boundaries', () => {
		const result = compile(SOURCE, '/project/app/Card.tsrx', {
			mode: 'client',
			hmr: false,
			reactHostedBoundary: {
				compatModule: '@fixture/octane-compat',
				nativeModuleId: 'app/Card.tsrx',
				nativeClient: true,
			},
		} as any);

		expect(result.code).toContain('registerOctaneBoundary');
		expect(result.code).toContain(`'app/Card.tsrx#Counter'`);
		expect(result.code).not.toContain(`from 'react'`);
		expect(result.code).not.toContain('OctaneCompat');
		expect(result.code).not.toContain('__octaneNativeId');
	});

	it('rejects an anonymous default because it cannot retain the Octane implementation identity', () => {
		expect(() =>
			compile(`'use client'; 'use octane'; export default () => <div />;`, '/app/Card.tsx', {
				reactHostedBoundary: {
					compatModule: '@fixture/octane-compat',
				},
			} as any),
		).toThrow(/named default component/);
	});

	for (const mode of ['client', 'server'] as const) {
		it(`migrates supported React imports before ${mode} boundary compilation`, () => {
			const result = compile(
				`'use client';
import { Fragment, useId, useState } from 'react';
import { createPortal } from 'react-dom';

export function MigratedCounter() {
	const [count] = useState(1);
	const id = useId();
	return <Fragment><span id={id}>{count}</span>{createPortal(<i />, document.body)}</Fragment>;
}`,
				'/app/MigratedCounter.tsx',
				{
					mode,
					hmr: false,
					migrateReactImports: true,
					reactHostedBoundary: {
						compatModule: '@fixture/octane-compat',
					},
				} as any,
			);
			const output = parseModule(result.code, 'boundary.js');
			const reactImports = output.body.filter(
				(node) => node.type === 'ImportDeclaration' && node.source.value === 'react',
			);
			const reactDomImports = output.body.filter(
				(node) => node.type === 'ImportDeclaration' && node.source.value === 'react-dom',
			);
			const octaneImports = output.body.filter(
				(node) =>
					node.type === 'ImportDeclaration' &&
					(node.source.value === 'octane' || node.source.value === 'octane/server'),
			);

			expect(reactImports).toHaveLength(1);
			expect(reactImports[0].specifiers).toEqual([
				expect.objectContaining({
					type: 'ImportSpecifier',
					imported: expect.objectContaining({ name: 'createElement' }),
				}),
			]);
			expect(reactDomImports).toHaveLength(0);
			expect(
				octaneImports.flatMap((node) =>
					node.specifiers
						.filter((specifier) => specifier.type === 'ImportSpecifier')
						.map((specifier) => specifier.imported.name),
				),
			).toEqual(expect.arrayContaining(['Fragment', 'createPortal', 'useId', 'useState']));
		});
	}

	it('migrates React imports for an Octane-owned module without adding a React facade', () => {
		const result = compile(
			`'use octane';
import { useMemo } from 'react';
export function ImportedChild(props) {
	const value = useMemo(() => props.value * 2, [props.value]);
	return <span>{value}</span>;
}`,
			'/app/ImportedChild.tsx',
			{
				hmr: false,
				migrateReactImports: true,
			} as any,
		);
		const output = parseModule(result.code, 'child.js');
		expect(
			output.body.some(
				(node) => node.type === 'ImportDeclaration' && node.source.value === 'react',
			),
		).toBe(false);
		expect(result.code).not.toContain('@fixture/octane-compat');
		expect(runtimeExports(result.code).names).toContain('ImportedChild');
	});

	for (const mode of ['client', 'server'] as const) {
		it(`wraps conventionally named null and factory components in ${mode} mode`, () => {
			const result = compile(
				`'use client';
import { lazy, memo } from 'react';

export function NullCard() {
	return null;
}

export const NullArrow = () => null;
export const MemoCard = memo(function MemoCardImpl() {
	return <strong>{'memo'}</strong>;
});
export const LazyCard = lazy(function LazyCardImpl() {
	return <em>{'lazy'}</em>;
});
export default memo(function DefaultMemoCard() {
	return <small>{'default memo'}</small>;
});`,
				'/app/NamedComponents.tsx',
				{
					mode,
					hmr: false,
					migrateReactImports: true,
					reactHostedBoundary: {
						compatModule: '@fixture/octane-compat',
					},
				} as any,
			);

			expect(result.code).toContain('component: NullCard');
			expect(result.code).toContain('component: NullArrow');
			expect(result.code).toContain('component: MemoCard');
			expect(result.code).toContain('component: LazyCard');
			expect(result.code).toContain('component: _$OctaneDefault');
			expect(runtimeExports(result.code).names).toContain('default');
		});
	}

	it.each([
		[`import React from 'react';`, /default React import/],
		[`import * as React from 'react';`, /namespace React import/],
		[`import { forwardRef } from 'react';`, /forwardRef/],
		[`import { createRoot } from 'react-dom/client';`, /react-dom\/client/],
	])('rejects an unsupported automatic-migration import', (declaration, expected) => {
		expect(() =>
			compile(
				`'use client'; ${declaration} export function Card() { return <div />; }`,
				'/app/Card.tsx',
				{
					migrateReactImports: true,
					reactHostedBoundary: {
						compatModule: '@fixture/octane-compat',
					},
				} as any,
			),
		).toThrow(expected);
	});

	it.each([
		[`import { Card } from './Card'; export { Card };`, /imported component export/],
		[`import Card from './Card'; export default Card;`, /imported default export/],
		[`export { Card } from './Card';`, /component re-exports/],
		[`export * from './Card';`, /export-star component ownership/],
	])('rejects a hosted export whose component ownership is unknown', (declaration, expected) => {
		expect(() =>
			compile(`'use client'; 'use octane'; ${declaration}`, '/app/Card.tsx', {
				reactHostedBoundary: {
					compatModule: '@fixture/octane-compat',
				},
			} as any),
		).toThrow(expected);
	});
});
