import { describe, expect, it } from 'vitest';
import { createOctanePlugin, withOctane } from '@octanejs/next';

describe('withOctane', () => {
	it('composes with synchronous and asynchronous Next config functions', async () => {
		const syncConfig = withOctane((_phase, { defaultConfig }) => ({
			...defaultConfig,
			cacheComponents: true,
		}));
		const asyncConfig = createOctanePlugin({ root: '/project' })(async () => ({
			reactCompiler: true,
		}));

		expect(typeof syncConfig).toBe('function');
		expect(typeof asyncConfig).toBe('function');

		const resolvedSyncConfig = await syncConfig('phase-production-build', {
			defaultConfig: { poweredByHeader: false },
		});
		const resolvedAsyncConfig = await asyncConfig('phase-production-build', {
			defaultConfig: {},
		});

		expect(resolvedSyncConfig).toMatchObject({
			cacheComponents: true,
			poweredByHeader: false,
		});
		expect(resolvedSyncConfig.turbopack?.rules?.['*.tsx']).toHaveLength(4);
		expect(resolvedAsyncConfig).toMatchObject({ reactCompiler: true });
		expect(resolvedAsyncConfig.turbopack?.rules?.['*.tsx']).toHaveLength(4);
	});

	it('adds environment-specific Turbopack rules without changing Next features', () => {
		const config = createOctanePlugin({
			root: '/project',
			profile: true,
			clientComponents: 'directive',
		})({
			cacheComponents: true,
			turbopack: {
				debugIds: true,
				resolveExtensions: ['.tsx', '.ts', '.js'],
				rules: {
					'*.svg': {
						loaders: ['raw-loader'],
						as: '*.js',
					},
				},
			},
		});

		expect((config as { cacheComponents?: boolean }).cacheComponents).toBe(true);
		expect(config.turbopack).toMatchObject({
			debugIds: true,
			resolveExtensions: ['.tsrx', '.tsx', '.ts', '.js'],
			rules: {
				'*.svg': {
					loaders: ['raw-loader'],
					as: '*.js',
				},
			},
		});
		const rules = config.turbopack?.rules?.['*.tsrx'];
		expect(rules).toHaveLength(4);
		expect(rules).toEqual([
			expect.objectContaining({
				condition: { all: ['browser', 'development', { not: 'foreign' }] },
				loaders: [
					expect.objectContaining({
						options: {
							root: '/project',
							environment: 'client',
							dev: true,
							profile: true,
							diagnostics: false,
							clientComponents: 'directive',
						},
					}),
				],
				as: '*.js',
			}),
			expect.objectContaining({
				condition: { all: ['browser', 'production', { not: 'foreign' }] },
				loaders: [
					expect.objectContaining({
						options: {
							root: '/project',
							environment: 'client',
							dev: false,
							profile: true,
							diagnostics: false,
							clientComponents: 'directive',
						},
					}),
				],
				as: '*.js',
			}),
			expect.objectContaining({
				condition: { all: ['node', 'development', { not: 'foreign' }] },
				loaders: [
					expect.objectContaining({
						options: {
							root: '/project',
							environment: 'server',
							dev: true,
							profile: false,
							diagnostics: false,
							clientComponents: 'directive',
						},
					}),
				],
				as: '*.js',
			}),
			expect.objectContaining({
				condition: { all: ['node', 'production', { not: 'foreign' }] },
				loaders: [
					expect.objectContaining({
						options: {
							root: '/project',
							environment: 'server',
							dev: false,
							profile: false,
							diagnostics: false,
							clientComponents: 'directive',
						},
					}),
				],
				as: '*.js',
			}),
		]);
		const typedRules = config.turbopack?.rules?.['*.tsx'] as
			Array<{ condition: unknown }> | undefined;
		expect(typedRules).toHaveLength(4);
		expect(typedRules).toEqual([
			expect.objectContaining({
				condition: {
					all: ['browser', 'development', { not: 'foreign' }, { content: expect.any(RegExp) }],
				},
				loaders: [
					expect.objectContaining({
						options: {
							root: '/project',
							environment: 'client',
							dev: true,
							profile: true,
							diagnostics: false,
							clientComponents: 'directive',
						},
					}),
				],
			}),
			expect.objectContaining({
				condition: {
					all: ['browser', 'production', { not: 'foreign' }, { content: expect.any(RegExp) }],
				},
			}),
			expect.objectContaining({
				condition: {
					all: ['node', 'development', { not: 'foreign' }, { content: expect.any(RegExp) }],
				},
			}),
			expect.objectContaining({
				condition: {
					all: ['node', 'production', { not: 'foreign' }, { content: expect.any(RegExp) }],
				},
			}),
		]);
		for (const rule of typedRules ?? []) {
			expect(rule).not.toHaveProperty('as');
			const content = (
				rule.condition as {
					all: Array<string | { content: RegExp }>;
				}
			).all[3] as { content: RegExp };
			expect(content.content.test(`'use client';\n'use octane';\n`)).toBe(true);
			expect(content.content.test(`'use client';\nexport function Counter() {}`)).toBe(false);
		}
	});

	it('does not duplicate the TSRX extension', () => {
		const config = withOctane({
			turbopack: {
				resolveExtensions: ['.tsrx', '.tsx', '.ts', '.js'],
			},
		});
		expect(config.turbopack?.resolveExtensions).toEqual(['.tsrx', '.tsx', '.ts', '.js']);
	});

	it('selects every use-client boundary with zero Octane configuration', () => {
		const config = withOctane({ cacheComponents: true });
		const typedRules = config.turbopack?.rules?.['*.tsx'] as
			Array<{ condition: unknown; loaders: unknown }> | undefined;
		expect(typedRules).toHaveLength(4);
		for (const rule of typedRules ?? []) {
			const sourceCondition = (
				rule.condition as {
					all: Array<string | { any: Array<{ content: RegExp }> }>;
				}
			).all[3] as { any: Array<{ content: RegExp }> };
			expect(
				sourceCondition.any.some(({ content }) =>
					content.test(`'use client';\nexport function Counter() {}`),
				),
			).toBe(true);
			expect(
				sourceCondition.any.some(({ content }) =>
					content.test(`'use octane';\nexport function Counter() {}`),
				),
			).toBe(true);
			expect(rule.loaders).toEqual([
				expect.objectContaining({
					options: expect.objectContaining({
						clientComponents: 'all',
					}),
				}),
			]);
		}
	});

	it('composes with existing Turbopack rules and rejects the unavailable native runtime', () => {
		const existingTsxRule = {
			condition: { content: /use workflow/ },
			loaders: ['workflow-loader'],
		};
		const existingTsrxRule = {
			loaders: ['instrumentation-loader'],
		};
		const config = withOctane({
			turbopack: {
				rules: {
					'*.tsrx': existingTsrxRule,
					'*.tsx': existingTsxRule,
				},
			},
		});

		const tsrxRules = config.turbopack?.rules?.['*.tsrx'] as unknown[];
		const tsxRules = config.turbopack?.rules?.['*.tsx'] as unknown[];
		expect(tsrxRules).toHaveLength(5);
		expect(tsxRules).toHaveLength(5);
		expect(tsrxRules[0]).toBe(existingTsrxRule);
		expect(tsxRules[0]).toBe(existingTsxRule);
		expect(tsrxRules.slice(1)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					loaders: [
						expect.objectContaining({
							options: expect.objectContaining({ clientComponents: 'all' }),
						}),
					],
				}),
			]),
		);
		expect(tsxRules.slice(1)).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					loaders: [
						expect.objectContaining({
							options: expect.objectContaining({ clientComponents: 'all' }),
						}),
					],
				}),
			]),
		);

		const reapplied = withOctane(config);
		expect(reapplied.turbopack?.rules?.['*.tsx']).toHaveLength(5);
		expect(reapplied.turbopack?.rules?.['*.tsrx']).toHaveLength(5);

		expect(() => createOctanePlugin({ runtime: 'native' as 'hybrid' })).toThrow(
			/Only runtime: "hybrid" is implemented/,
		);
		expect(() => createOctanePlugin({ clientComponents: 'octane' as 'all' })).toThrow(
			/clientComponents/,
		);
	});
});
