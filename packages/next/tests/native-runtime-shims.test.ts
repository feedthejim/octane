import { describe, expect, it, vi } from 'vitest';
import ReactDOM, {
	__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
	createPortal,
} from '../src/react-dom.js';
import {
	getOctaneBoundary,
	registerOctaneBoundary,
	resolveOctaneBoundary,
	subscribeOctaneBoundaries,
} from '../src/native-registry.js';

describe('native client runtime shims', () => {
	it('supports the named and default ReactDOM contracts used by Next client modules', () => {
		expect(ReactDOM.createPortal).toBe(createPortal);
		expect(ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE).toBe(
			__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
		);
		expect(ReactDOM.__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.d.D).toBeTypeOf(
			'function',
		);
	});

	it('indexes compiler-registered boundaries by stable id and client facade', () => {
		const component = () => null;
		const facade = () => null;
		const listener = vi.fn();
		const unsubscribe = subscribeOctaneBoundaries(listener);

		registerOctaneBoundary('app/theme.tsx#Theme', component, facade);
		unsubscribe();

		expect(getOctaneBoundary('app/theme.tsx#Theme')).toEqual({
			id: 'app/theme.tsx#Theme',
			component,
		});
		expect(resolveOctaneBoundary(facade)?.component).toBe(component);
		expect(listener).toHaveBeenCalledOnce();
	});
});
