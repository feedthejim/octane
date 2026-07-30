import 'next/dist/client/register-deployment-id-global';
import { appBootstrap } from 'next/dist/client/app-bootstrap';
import { createElement, hydrateRoot } from 'octane';
import { getOctaneBoundary, subscribeOctaneBoundaries } from './native-registry.js';
import { createNativeRouter } from './native-navigation.js';

window.next.turbopack = true;
self.__webpack_hash__ = '';

const hydratedHosts = new WeakSet();
const moduleLoads = new Map();
const roots = new Map();
let hostsById = new Map();

function nativeHostedEnvelope(props) {
	const config =
		props.bodyKey === null ? props.bodyProps : { ...props.bodyProps, key: props.bodyKey };
	return createElement(props.body, config);
}

function indexHosts() {
	const nextHosts = new Map();
	for (const host of document.querySelectorAll('[data-octane-native]')) {
		const id = host.getAttribute('data-octane-native');
		if (id === null) continue;
		const hosts = nextHosts.get(id);
		if (hosts === undefined) nextHosts.set(id, [host]);
		else hosts.push(host);
	}
	hostsById = nextHosts;
}

function hydrateHost(wrapper, boundary) {
	if (hydratedHosts.has(wrapper)) return;
	const host = wrapper.querySelector('[data-octane-compat]');
	if (!(host instanceof HTMLElement)) return;
	const encoded = wrapper.getAttribute('data-octane-props');
	if (encoded === null) {
		throw new Error(
			`Octane native boundary ${JSON.stringify(boundary.id)} has no resumable props.`,
		);
	}
	const identifierPrefix = host.dataset.octaneIdentifierPrefix ?? '';
	const root = hydrateRoot(
		host,
		nativeHostedEnvelope,
		{
			body: boundary.component,
			bodyProps: JSON.parse(encoded),
			bodyKey: null,
		},
		{ identifierPrefix },
	);
	hydratedHosts.add(wrapper);
	roots.set(wrapper, root);
	wrapper.setAttribute('data-octane-native-hydrated', '');
}

function hydrateBoundary(boundary) {
	for (const wrapper of hostsById.get(boundary.id) ?? []) {
		try {
			hydrateHost(wrapper, boundary);
		} catch (error) {
			console.error('[Octane Next native boundary]', error);
		}
	}
}

async function loadClientReference(entry) {
	const [modulePath, moduleId, chunks, isAsync] = entry;
	let loading = moduleLoads.get(modulePath);
	if (loading !== undefined) return loading;

	loading = (async () => {
		await Promise.all(chunks.map((chunk) => __turbopack_load_by_url__(chunk)));
		const exports = __turbopack_require__(moduleId);
		if (isAsync && exports !== null && typeof exports?.then === 'function') {
			await exports;
		}
	})();
	moduleLoads.set(modulePath, loading);
	return loading;
}

async function loadBoundaryModules() {
	// A Next client reference can render imported Octane components whose own
	// modules are not separate Flight references. Loading every compact
	// route-local entry lets those imports register their nested boundaries,
	// while the server-side resume filter keeps framework internals out.
	const references = new Map(
		(self.__next_client_reference_resume__ ?? []).map((entry) => [entry[0], entry]),
	);
	await Promise.all([...references.values()].map(loadClientReference));
}

async function startNativeRuntime() {
	indexHosts();
	const unsubscribe = subscribeOctaneBoundaries(hydrateBoundary);
	try {
		for (const id of hostsById.keys()) {
			const boundary = getOctaneBoundary(id);
			if (boundary !== null) hydrateBoundary(boundary);
		}
		await loadBoundaryModules();
		for (const id of hostsById.keys()) {
			const boundary = getOctaneBoundary(id);
			if (boundary !== null) hydrateBoundary(boundary);
		}
	} finally {
		unsubscribe();
	}
}

appBootstrap(() => {
	void startNativeRuntime()
		.then(() => {
			window.next.router = createNativeRouter({
				activate: startNativeRuntime,
				deactivate() {
					for (const root of roots.values()) root.unmount();
					roots.clear();
				},
			});
		})
		.catch((error) => {
			console.error('[Octane Next native runtime]', error);
		});
});
