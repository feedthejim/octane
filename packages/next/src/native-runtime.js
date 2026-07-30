import 'next/dist/client/register-deployment-id-global';
import { appBootstrap } from 'next/dist/client/app-bootstrap';
import { hydrateRoot } from 'octane';
import { createFromReadableStream } from 'react-server-dom-webpack/client';
import {
	getOctaneBoundary,
	resolveOctaneBoundary,
	subscribeOctaneBoundaries,
} from './native-registry.js';

window.next.turbopack = true;
self.__webpack_hash__ = '';

const REACT_ELEMENT_TYPE = Symbol.for('react.transitional.element');
const REACT_LAZY_TYPE = Symbol.for('react.lazy');
const encoder = new TextEncoder();
const hostsById = new Map();
const hydratedHosts = new WeakSet();
const nextHostIndex = new Map();

let initialServerDataBuffer;
let initialServerDataWriter;
let initialServerDataLoaded = false;
let initialServerDataFlushed = false;

function nextServerDataCallback(segment) {
	if (segment[0] === 0) {
		initialServerDataBuffer = [];
		return;
	}
	if (segment[0] === 2) return;
	if (!initialServerDataBuffer) {
		throw new Error('Unexpected server data: missing bootstrap script.');
	}
	let chunk;
	if (segment[0] === 1) {
		chunk = encoder.encode(segment[1]);
	} else if (segment[0] === 3) {
		const binary = atob(segment[1]);
		chunk = Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} else {
		return;
	}
	if (initialServerDataWriter) initialServerDataWriter.enqueue(chunk);
	else initialServerDataBuffer.push(chunk);
}

function registerWriter(controller) {
	for (const chunk of initialServerDataBuffer ?? []) controller.enqueue(chunk);
	if (initialServerDataLoaded && !initialServerDataFlushed) {
		controller.close();
		initialServerDataFlushed = true;
		initialServerDataBuffer = undefined;
	}
	initialServerDataWriter = controller;
}

function closeInitialStream() {
	if (initialServerDataWriter && !initialServerDataFlushed) {
		initialServerDataWriter.close();
		initialServerDataFlushed = true;
		initialServerDataBuffer = undefined;
	}
	initialServerDataLoaded = true;
}

function indexHosts() {
	for (const host of document.querySelectorAll('[data-octane-native]')) {
		const id = host.getAttribute('data-octane-native');
		if (id === null) continue;
		const hosts = hostsById.get(id);
		if (hosts === undefined) hostsById.set(id, [host]);
		else hosts.push(host);
	}
}

function hydrateBoundary(id, props) {
	const boundary = getOctaneBoundary(id);
	const hosts = hostsById.get(id);
	if (boundary === null || hosts === undefined) return false;
	let index = nextHostIndex.get(id) ?? 0;
	while (index < hosts.length && hydratedHosts.has(hosts[index])) index += 1;
	const wrapper = hosts[index];
	if (wrapper === undefined) return false;
	const host = wrapper.querySelector('[data-octane-compat]');
	if (!(host instanceof HTMLElement)) return false;
	hydrateRoot(host, boundary.component, props);
	hydratedHosts.add(wrapper);
	nextHostIndex.set(id, index + 1);
	wrapper.setAttribute('data-octane-native-hydrated', '');
	return true;
}

function hydrateSerializableHosts(id) {
	const hosts = hostsById.get(id) ?? [];
	for (const wrapper of hosts) {
		if (hydratedHosts.has(wrapper)) continue;
		const encoded = wrapper.getAttribute('data-octane-props');
		if (encoded === null) continue;
		try {
			hydrateBoundary(id, JSON.parse(encoded));
		} catch (error) {
			console.error(error);
		}
	}
}

async function resolveLazy(value) {
	for (;;) {
		try {
			return value._init(value._payload);
		} catch (error) {
			if (error !== null && typeof error?.then === 'function') {
				await error;
				continue;
			}
			throw error;
		}
	}
}

async function discoverBoundaries(value, seen) {
	if (value === null || value === undefined) return;
	if (typeof value !== 'object') return;
	if (seen.has(value)) return;
	seen.add(value);

	if (value.$$typeof === REACT_LAZY_TYPE) {
		await discoverBoundaries(await resolveLazy(value), seen);
		return;
	}
	if (value.$$typeof === REACT_ELEMENT_TYPE) {
		let type = value.type;
		if (type?.$$typeof === REACT_LAZY_TYPE) type = await resolveLazy(type);
		const boundary = resolveOctaneBoundary(type);
		if (boundary !== null) hydrateBoundary(boundary.id, value.props ?? {});
		await discoverBoundaries(value.props, seen);
		return;
	}
	if (Array.isArray(value)) {
		for (const child of value) await discoverBoundaries(child, seen);
		return;
	}
	for (const child of Object.values(value)) {
		await discoverBoundaries(child, seen);
	}
}

async function startNativeRuntime() {
	indexHosts();
	const unsubscribe = subscribeOctaneBoundaries((boundary) => {
		hydrateSerializableHosts(boundary.id);
	});
	try {
		for (const id of hostsById.keys()) hydrateSerializableHosts(id);
		const payload = await createFromReadableStream(new ReadableStream({ start: registerWriter }), {
			callServer() {
				throw new Error(
					'Server Actions require the React App Router and are not available in the Octane native prototype.',
				);
			},
			findSourceMapURL() {
				return null;
			},
			startTime: 0,
		});
		await discoverBoundaries(payload, new WeakSet());
		for (const id of hostsById.keys()) hydrateSerializableHosts(id);
	} finally {
		unsubscribe();
	}
}

const nextServerDataLoadingGlobal = (self.__next_f = self.__next_f || []);
nextServerDataLoadingGlobal.forEach(nextServerDataCallback);
nextServerDataLoadingGlobal.length = 0;
nextServerDataLoadingGlobal.push = nextServerDataCallback;

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', closeInitialStream, false);
} else {
	setTimeout(closeInitialStream);
}

appBootstrap(() => {
	void startNativeRuntime().catch((error) => {
		console.error('[Octane Next native runtime]', error);
	});
});
