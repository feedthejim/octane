import { describe, expect, it, vi } from 'vitest';
import reactCompilerGuardLoader from '../src/react-compiler-guard-loader.js';

function runGuard(source: string) {
	let output: string | undefined;
	const context = {
		sourceMap: true,
		cacheable: vi.fn(),
		callback: (_error: Error | null, content: string) => {
			output = content;
		},
	};
	reactCompilerGuardLoader.call(context, source, null);
	return { context, output };
}

describe('React Compiler guard loader', () => {
	it('adds one module-level opt-out directive', () => {
		const first = runGuard('export function useRuntimeHook() {}');
		const second = runGuard(first.output!);

		expect(first.output).toBe(`'use no memo';export function useRuntimeHook() {}`);
		expect(second.output).toBe(first.output);
		expect(first.context.cacheable).toHaveBeenCalledWith(true);
	});
});
