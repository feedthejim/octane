const REGISTRY_KEY = Symbol.for('octane.next.native-boundaries');

function registry() {
	return (globalThis[REGISTRY_KEY] ??= {
		byFacade: new WeakMap(),
		byId: new Map(),
		listeners: new Set(),
	});
}

export function registerOctaneBoundary(id, component, facade) {
	const state = registry();
	const boundary = Object.freeze({ id, component });
	state.byId.set(id, boundary);
	state.byFacade.set(facade, boundary);
	for (const listener of state.listeners) listener(boundary);
}

export function getOctaneBoundary(id) {
	return registry().byId.get(id) ?? null;
}

export function resolveOctaneBoundary(facade) {
	return registry().byFacade.get(facade) ?? null;
}

export function subscribeOctaneBoundaries(listener) {
	const state = registry();
	state.listeners.add(listener);
	return () => state.listeners.delete(listener);
}
