import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { parseModule } from '@tsrx/core';
import { createOctaneCompiler } from 'octane/compiler/bundler';

function loaderError(code, filename, node, message) {
	const start = node?.loc?.start;
	const at = start ? `${filename}:${start.line}:${start.column}` : filename;
	const error = new Error(`${message} (${at})`);
	error.code = code;
	error.filename = filename;
	error.loc = start ? Object.freeze({ line: start.line, column: start.column }) : null;
	return error;
}

function inspectBoundaryDirectives(source, filename) {
	const ast = parseModule(source, filename);
	let client = false;
	let octane = false;
	let react = false;
	for (const statement of ast.body ?? []) {
		if (statement.type !== 'ExpressionStatement' || statement.directive === undefined) break;
		if (statement.directive === 'use client') client = true;
		if (statement.directive === 'use octane') octane = true;
		if (statement.directive === 'use react') react = true;
	}
	return { ast, client, octane, react };
}

function valueImportSpecifiers(node) {
	if (node.importKind === 'type') return [];
	return (node.specifiers ?? []).filter((specifier) => specifier.importKind !== 'type');
}

function isRelativeRequest(request) {
	return request.startsWith('./') || request.startsWith('../');
}

function importedName(specifier) {
	return (
		specifier.imported?.name ?? specifier.imported?.value ?? specifier.local?.name ?? '<unknown>'
	);
}

function resolveRelativeModule(resource, request) {
	const base = resolve(dirname(resource), request);
	const candidates =
		extname(base) === ''
			? [
					base,
					...['.tsx', '.ts', '.jsx', '.js', '.tsrx'].map((extension) => base + extension),
					...['.tsx', '.ts', '.jsx', '.js', '.tsrx'].map((extension) =>
						resolve(base, `index${extension}`),
					),
				]
			: [base];
	return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function hasProvenOctaneOwnership(resource, request, context) {
	const importedResource = resolveRelativeModule(resource, request);
	if (importedResource === null) return false;
	context.addDependency?.(importedResource);
	if (importedResource.endsWith('.tsrx')) return true;
	const source = readFileSync(importedResource, 'utf8');
	const boundary = inspectBoundaryDirectives(source, importedResource);
	return boundary.octane && !boundary.client;
}

function automaticReactFallbackReason(ast, resource, context) {
	for (const statement of ast.body ?? []) {
		if (statement.type === 'ExportAllDeclaration' && statement.exportKind !== 'type') {
			return 'export-star ownership cannot be proven';
		}
		if (
			statement.type === 'ExportNamedDeclaration' &&
			statement.exportKind !== 'type' &&
			statement.source != null
		) {
			return `re-export ownership from ${JSON.stringify(statement.source.value)} cannot be proven`;
		}
		if (statement.type !== 'ImportDeclaration') continue;
		const request = statement.source?.value;
		if (typeof request !== 'string') return 'an import has an unknown module request';
		const specifiers = valueImportSpecifiers(statement);
		if (specifiers.length === 0) continue;
		if (request === 'octane') continue;
		if (request === 'react' || request === 'react-dom') {
			if (
				request === 'react' &&
				specifiers.some((specifier) => {
					const name = importedName(specifier);
					return name === 'ViewTransition' || name === 'unstable_ViewTransition';
				})
			) {
				return 'React ViewTransition boundaries require React-owned transition coordination';
			}
			const unsupportedShape = specifiers.find(
				(specifier) =>
					specifier.type === 'ImportDefaultSpecifier' ||
					specifier.type === 'ImportNamespaceSpecifier',
			);
			if (unsupportedShape !== undefined) {
				return `${request} ${unsupportedShape.type === 'ImportDefaultSpecifier' ? 'default' : 'namespace'} imports are not automatically migrated`;
			}
			continue;
		}
		if (!isRelativeRequest(request)) {
			return `the client dependency ${JSON.stringify(request)} has no Octane compatibility contract`;
		}
		const importedComponent = specifiers.find(
			(specifier) =>
				specifier.type === 'ImportDefaultSpecifier' ||
				specifier.type === 'ImportNamespaceSpecifier' ||
				/^[A-Z]/.test(importedName(specifier)),
		);
		if (importedComponent !== undefined && !hasProvenOctaneOwnership(resource, request, context)) {
			return `the imported component ${JSON.stringify(importedName(importedComponent))} from ${JSON.stringify(request)} has no proven Octane ownership`;
		}
	}

	const seen = new WeakSet();
	const walk = (node) => {
		if (node == null || typeof node !== 'object') return false;
		if (Array.isArray(node)) return node.some(walk);
		if (seen.has(node)) return false;
		seen.add(node);
		if (
			node.type === 'MemberExpression' &&
			node.computed !== true &&
			node.property?.type === 'Identifier' &&
			node.property.name === 'children'
		) {
			return true;
		}
		if (node.type === 'ObjectPattern') {
			for (const property of node.properties ?? []) {
				const key = property.key?.name ?? property.key?.value;
				if (key === 'children') return true;
			}
		}
		for (const [key, value] of Object.entries(node)) {
			if (
				key === 'type' ||
				key === 'loc' ||
				key === 'start' ||
				key === 'end' ||
				key === 'range' ||
				key === 'metadata' ||
				key === 'parent'
			) {
				continue;
			}
			if (walk(value)) return true;
		}
		return false;
	};
	return walk(ast) ? 'renderable children require React-owned slot semantics' : null;
}

function keepOnReact(context, callback, source, inputSourceMap, resource, reason, diagnostics) {
	if (diagnostics) {
		const warning = new Error(`[@octanejs/next] Keeping ${resource} on React: ${reason}.`);
		warning.code = 'OCTANE_NEXT_REACT_FALLBACK';
		warning.filename = resource;
		context.emitWarning?.(warning);
	}
	callback(null, source, context.sourceMap === false ? undefined : inputSourceMap);
}

function validateHostedBoundaryExports(ast, filename) {
	const importedLocals = new Set();
	for (const statement of ast.body ?? []) {
		if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue;
		for (const specifier of statement.specifiers ?? []) {
			if (specifier.importKind !== 'type' && specifier.local?.name) {
				importedLocals.add(specifier.local.name);
			}
		}
	}
	for (const statement of ast.body ?? []) {
		if (statement.type === 'ExportAllDeclaration' && statement.exportKind !== 'type') {
			throw loaderError(
				'OCTANE_NEXT_EXPORT_STAR_UNSUPPORTED',
				filename,
				statement,
				'Octane Next client boundaries cannot classify `export *`. Define a local wrapper component or add `"use react"`',
			);
		}
		if (
			statement.type === 'ExportNamedDeclaration' &&
			statement.exportKind !== 'type' &&
			statement.source != null
		) {
			throw loaderError(
				'OCTANE_NEXT_REEXPORT_UNSUPPORTED',
				filename,
				statement,
				'Octane Next client boundaries cannot classify component re-exports. Define a local wrapper component or add `"use react"`',
			);
		}
		if (
			statement.type === 'ExportDefaultDeclaration' &&
			statement.declaration?.type === 'Identifier' &&
			importedLocals.has(statement.declaration.name)
		) {
			throw loaderError(
				'OCTANE_NEXT_IMPORTED_COMPONENT_EXPORT_UNSUPPORTED',
				filename,
				statement,
				'Octane Next client boundaries cannot classify an imported default export. Define a local wrapper component or add `"use react"`',
			);
		}
		if (
			statement.type === 'ExportNamedDeclaration' &&
			statement.exportKind !== 'type' &&
			statement.source == null
		) {
			for (const specifier of statement.specifiers ?? []) {
				const local = specifier.local?.name;
				const exported = specifier.exported?.name ?? specifier.exported?.value;
				if (
					importedLocals.has(local) &&
					(/^[A-Z]/.test(local ?? '') || /^[A-Z]/.test(exported ?? ''))
				) {
					throw loaderError(
						'OCTANE_NEXT_IMPORTED_COMPONENT_EXPORT_UNSUPPORTED',
						filename,
						specifier,
						'Octane Next client boundaries cannot classify an imported component export. Define a local wrapper component or add `"use react"`',
					);
				}
			}
		}
	}
}

function registerDependencies(context, result) {
	for (const dependency of new Set(result.dependencies ?? [])) {
		context.addDependency?.(dependency);
	}
	for (const dependency of new Set(result.missingDependencies ?? [])) {
		context.addMissingDependency?.(dependency);
	}
}

function cleanResource(context) {
	const resource = context.resource ?? context.resourcePath;
	const queryIndex = resource.indexOf('?');
	return queryIndex === -1 ? resource : resource.slice(0, queryIndex);
}

function optOutOfReactCompiler(source) {
	// Next applies React Compiler after custom Turbopack loaders. Its memo-cache
	// calls are React hooks and cannot execute inside an Octane-owned component
	// body, so keep the compiled module outside that second compiler pass.
	return `'use no memo';${source}`;
}

/**
 * Turbopack's loader context does not expose webpack `mode` or `target`, so the
 * Next config wrapper supplies both environment and development mode through
 * JSON-serializable options selected by Turbopack rule conditions.
 */
export default function octaneNextLoader(source, inputSourceMap) {
	this.cacheable?.(true);
	const callback = this.callback.bind(this);
	try {
		const options = this.getOptions?.() ?? {};
		const resource = cleanResource(this);
		const text = String(source);
		const boundary = inspectBoundaryDirectives(text, resource);
		const clientBoundary = boundary.client;
		const clientComponents = options.clientComponents ?? 'all';
		if (clientComponents !== 'directive' && clientComponents !== 'all') {
			throw new TypeError(
				'[@octanejs/next] loader clientComponents must be explicitly set to "directive" or "all".',
			);
		}
		if (boundary.octane && boundary.react) {
			throw loaderError(
				'OCTANE_NEXT_CONFLICTING_OWNERSHIP_DIRECTIVES',
				resource,
				null,
				'An Octane Next boundary cannot declare both `"use octane"` and `"use react"`',
			);
		}
		if (clientBoundary && resource.endsWith('.tsrx')) {
			throw loaderError(
				'OCTANE_NEXT_TSRX_CLIENT_BOUNDARY_UNSUPPORTED',
				resource,
				null,
				'Next cannot currently re-resolve a client boundary emitted by a custom-extension Turbopack loader. Move the boundary to a `.tsx` module, add a leading `"use octane"` directive, and use standard JSX syntax',
			);
		}
		if (resource.endsWith('.tsx')) {
			if (clientComponents === 'directive' && !boundary.octane) {
				callback(null, source, this.sourceMap === false ? undefined : inputSourceMap);
				return;
			}
			if (clientComponents === 'all' && !clientBoundary && !boundary.octane) {
				callback(null, source, this.sourceMap === false ? undefined : inputSourceMap);
				return;
			}
			if (clientComponents === 'all' && boundary.react) {
				callback(null, source, this.sourceMap === false ? undefined : inputSourceMap);
				return;
			}
			if (clientComponents === 'all' && clientBoundary && !boundary.octane) {
				const fallbackReason = automaticReactFallbackReason(boundary.ast, resource, this);
				if (fallbackReason !== null) {
					keepOnReact(
						this,
						callback,
						source,
						inputSourceMap,
						resource,
						fallbackReason,
						options.diagnostics === true,
					);
					return;
				}
			}
		}
		if (clientBoundary) validateHostedBoundaryExports(boundary.ast, resource);
		const environment = options.environment;
		if (environment !== 'client' && environment !== 'server') {
			throw new TypeError(
				'[@octanejs/next] loader environment must be explicitly set to "client" or "server".',
			);
		}
		const compiler = createOctaneCompiler({
			root: options.root ?? this.rootContext ?? process.cwd(),
			profile: environment === 'client' && options.profile === true,
			requireDirective: false,
			warn: (message) => this.emitWarning?.(new Error(message)),
		});
		const result = compiler.transform(optOutOfReactCompiler(text), this.resource ?? resource, {
			environment,
			hmr: false,
			dev: environment === 'client' && options.dev === true,
			profile: environment === 'client' && options.profile === true,
			...(resource.endsWith('.tsx') && (clientComponents === 'all' || boundary.octane)
				? { migrateReactImports: true }
				: null),
			...(clientBoundary
				? {
						reactHostedBoundary: {
							compatModule: '@octanejs/next/compat',
						},
					}
				: null),
		});
		if (result === null || result.kind === 'none') {
			callback(null, source, this.sourceMap === false ? undefined : inputSourceMap);
			return;
		}
		registerDependencies(this, result);
		callback(null, result.code, this.sourceMap === false ? undefined : result.map);
	} catch (error) {
		callback(error instanceof Error ? error : new Error(String(error)));
	}
}
