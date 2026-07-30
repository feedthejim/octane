import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, isAbsolute, parse, relative, resolve, sep } from 'node:path';

const OCTANE_LOADER = fileURLToPath(new URL('./loader.js', import.meta.url));
const REACT_COMPILER_GUARD_LOADER = fileURLToPath(
	new URL('./react-compiler-guard-loader.js', import.meta.url),
);
const PACKAGE_ROOT = dirname(dirname(OCTANE_LOADER));
const REQUIRE = createRequire(import.meta.url);
const DEFAULT_EXTENSIONS = ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.json'];
const USE_CLIENT_DIRECTIVE = /^[ \t]*['"]use client['"][ \t]*;?/m;
const USE_OCTANE_DIRECTIVE = /^[ \t]*['"]use octane['"][ \t]*;?/m;

function loaderRule(
	root,
	environment,
	dev,
	profile,
	diagnostics,
	clientComponents,
	runtime,
	outputType,
	sourceCondition,
) {
	return {
		condition: {
			all: [
				environment === 'client' ? 'browser' : 'node',
				dev ? 'development' : 'production',
				{ not: 'foreign' },
				...(sourceCondition === undefined ? [] : [sourceCondition]),
			],
		},
		loaders: [
			{
				loader: OCTANE_LOADER,
				options: {
					root,
					environment,
					dev,
					profile,
					diagnostics,
					clientComponents,
					...(runtime === 'native' ? { native: true } : null),
				},
			},
		],
		...(outputType === undefined ? null : { as: outputType }),
	};
}

function isWithin(root, target) {
	const path = relative(root, target);
	return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function commonAncestor(left, right) {
	let ancestor = resolve(left);
	const target = resolve(right);
	while (!isWithin(ancestor, target)) {
		const parent = dirname(ancestor);
		if (parent === ancestor) return ancestor;
		ancestor = parent;
	}
	return ancestor;
}

function inferredLinkedRoot(projectRoot, configuredRoot, rootWasExplicit) {
	if (configuredRoot !== undefined || rootWasExplicit || isWithin(projectRoot, PACKAGE_ROOT)) {
		return configuredRoot;
	}
	const ancestor = commonAncestor(projectRoot, PACKAGE_ROOT);
	return ancestor === parse(ancestor).root ? undefined : ancestor;
}

function normalizeExtensions(extensions) {
	const result = ['.tsrx', ...(extensions ?? DEFAULT_EXTENSIONS)];
	return [...new Set(result)];
}

function workspaceRuntimeResolution(projectRoot) {
	let entry;
	try {
		entry = REQUIRE.resolve('octane');
	} catch {
		return { aliases: {}, distRoot: null };
	}
	const packageRoot = dirname(dirname(entry));
	const sourceRoot = resolve(packageRoot, 'src');
	const manifestPath = resolve(packageRoot, 'package.json');
	if (!isWithin(sourceRoot, entry) || !existsSync(manifestPath)) {
		return { aliases: {}, distRoot: null };
	}

	try {
		const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		const publishedExports = manifest.publishConfig?.exports;
		if (manifest.name !== 'octane' || publishedExports == null) {
			return { aliases: {}, distRoot: null };
		}
		const aliases = {};
		for (const [specifier, definition] of Object.entries(publishedExports)) {
			const target =
				typeof definition === 'string'
					? definition
					: typeof definition?.default === 'string'
						? definition.default
						: null;
			if (target === null) continue;
			const absoluteTarget = resolve(packageRoot, target);
			if (!existsSync(absoluteTarget)) continue;
			const projectRelativeTarget = relative(projectRoot, absoluteTarget).split(sep).join('/');
			aliases[specifier === '.' ? 'octane' : `octane${specifier.slice(1)}`] =
				projectRelativeTarget.startsWith('.')
					? projectRelativeTarget
					: `./${projectRelativeTarget}`;
		}
		return { aliases, distRoot: resolve(packageRoot, 'dist') };
	} catch {
		return { aliases: {}, distRoot: null };
	}
}

function mergeRules(existingRules, addedRules, loaderPath = OCTANE_LOADER) {
	if (existingRules === undefined) return addedRules;
	const rules = Array.isArray(existingRules) ? existingRules : [existingRules];
	const alreadyConfigured = rules.some(
		(rule) =>
			typeof rule === 'object' &&
			rule !== null &&
			'loaders' in rule &&
			rule.loaders?.some(
				(loader) =>
					(typeof loader === 'string' && loader === loaderPath) ||
					(typeof loader === 'object' && loader !== null && loader.loader === loaderPath),
			),
	);
	return alreadyConfigured ? rules : [...rules, ...addedRules];
}

function escapeRegExp(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Configure the Turbopack-only hybrid Next.js integration.
 *
 * Next continues to own Flight, App Router, and Cache Components. In directive
 * mode, a `.tsx` module with leading `"use client"` and `"use octane"`
 * directives becomes a normal Next client reference whose exported components
 * are hosted through OctaneCompat. All mode selects every `.tsx` `"use client"`
 * boundary unless it opts out with `"use react"`.
 */
export function createOctanePlugin(options = {}) {
	const {
		clientComponents = 'all',
		diagnostics = process.env.OCTANE_NEXT_DIAGNOSTICS === '1',
		profile = false,
		runtime = 'hybrid',
		root = process.cwd(),
	} = options;

	if (clientComponents !== 'directive' && clientComponents !== 'all') {
		throw new TypeError('[@octanejs/next] clientComponents must be "directive" or "all".');
	}
	if (runtime !== 'hybrid' && runtime !== 'native') {
		throw new TypeError('[@octanejs/next] runtime must be "hybrid" or "native".');
	}
	if (typeof root !== 'string' || !isAbsolute(root)) {
		throw new TypeError('[@octanejs/next] root must be a non-empty absolute project path.');
	}

	function applyResolvedConfig(nextConfig = {}) {
		const turbopack = nextConfig.turbopack ?? {};

		const octaneRules = (outputType, sourceCondition) => [
			loaderRule(
				root,
				'client',
				true,
				profile,
				diagnostics,
				clientComponents,
				runtime,
				outputType,
				sourceCondition,
			),
			loaderRule(
				root,
				'client',
				false,
				profile,
				diagnostics,
				clientComponents,
				runtime,
				outputType,
				sourceCondition,
			),
			loaderRule(
				root,
				'server',
				true,
				false,
				diagnostics,
				clientComponents,
				runtime,
				outputType,
				sourceCondition,
			),
			loaderRule(
				root,
				'server',
				false,
				false,
				diagnostics,
				clientComponents,
				runtime,
				outputType,
				sourceCondition,
			),
		];
		const typedSourceCondition =
			clientComponents === 'all'
				? {
						any: [{ content: USE_CLIENT_DIRECTIVE }, { content: USE_OCTANE_DIRECTIVE }],
					}
				: { content: USE_OCTANE_DIRECTIVE };
		const turbopackRoot = inferredLinkedRoot(
			root,
			turbopack.root,
			Object.prototype.hasOwnProperty.call(options, 'root'),
		);
		const workspaceRuntime = workspaceRuntimeResolution(root);
		const effectiveTurbopackRoot = turbopackRoot ?? root;
		const workspaceGuardPath =
			workspaceRuntime.distRoot === null
				? null
				: relative(effectiveTurbopackRoot, workspaceRuntime.distRoot).split(sep).join('/');
		const workspaceGuardRule =
			workspaceGuardPath === null
				? null
				: {
						condition: {
							all: [
								{ not: 'foreign' },
								{ path: new RegExp(`^${escapeRegExp(workspaceGuardPath)}/`) },
							],
						},
						loaders: [REACT_COMPILER_GUARD_LOADER],
					};

		return {
			...nextConfig,
			...(runtime === 'native' ? { cacheComponents: true } : null),
			turbopack: {
				...turbopack,
				...(runtime === 'native'
					? {
							clientRuntime: {
								entry: '@octanejs/next/native-runtime',
								reactDom: '@octanejs/next/react-dom',
								clientReferences: 'resume',
							},
						}
					: null),
				...(turbopackRoot === undefined ? null : { root: turbopackRoot }),
				resolveAlias: {
					...workspaceRuntime.aliases,
					...turbopack.resolveAlias,
				},
				resolveExtensions: normalizeExtensions(turbopack.resolveExtensions),
				rules: {
					...turbopack.rules,
					'*.tsrx': mergeRules(turbopack.rules?.['*.tsrx'], octaneRules('*.js')),
					'*.tsx': mergeRules(
						turbopack.rules?.['*.tsx'],
						octaneRules(undefined, typedSourceCondition),
					),
					...(workspaceGuardRule === null
						? null
						: {
								'*.js': mergeRules(
									turbopack.rules?.['*.js'],
									[workspaceGuardRule],
									REACT_COMPILER_GUARD_LOADER,
								),
							}),
				},
			},
		};
	}

	return function applyOctane(nextConfig = {}) {
		if (typeof nextConfig !== 'function') {
			return applyResolvedConfig(nextConfig);
		}

		return function octaneNextConfig(phase, context) {
			const resolvedConfig = nextConfig(phase, context);
			if (resolvedConfig?.then === undefined) {
				return applyResolvedConfig(resolvedConfig);
			}
			return resolvedConfig.then(applyResolvedConfig);
		};
	};
}

/**
 * Apply the zero-configuration Octane integration to a Next config.
 *
 * Every application `.tsx` `"use client"` boundary is considered for Octane
 * compilation. Boundaries that the plugin cannot prove compatible remain on
 * React, and `"use react"` is the explicit escape hatch.
 */
export function withOctane(nextConfig = {}) {
	return createOctanePlugin()(nextConfig);
}
