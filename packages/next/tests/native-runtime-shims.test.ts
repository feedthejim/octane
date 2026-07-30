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
import {
	readClientReferenceResumeEntries,
	shouldHandleNavigationClick,
} from '../src/native-navigation.js';

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

	it('reads the compact resume manifest without evaluating bootstrap code', () => {
		const nextDocument = {
			scripts: [
				{
					textContent:
						'self.__next_r="request";self.__next_client_reference_resume__=[["[project]/app/card.tsx",17,["/_next/card.js"],false]];self.after=true',
				},
			],
		} as unknown as Document;

		expect(readClientReferenceResumeEntries(nextDocument)).toEqual([
			['[project]/app/card.tsx', 17, ['/_next/card.js'], false],
		]);
		expect((globalThis as { after?: boolean }).after).toBeUndefined();
	});

	it('intercepts only unmodified same-origin document navigations', () => {
		const anchor = {
			dataset: {},
			hasAttribute: () => false,
			href: 'https://example.com/read',
			target: '',
		} as unknown as HTMLAnchorElement;
		const currentLocation = new URL('https://example.com/') as unknown as Location;
		const click = {
			defaultPrevented: false,
			button: 0,
			metaKey: false,
			ctrlKey: false,
			shiftKey: false,
			altKey: false,
		} as MouseEvent;

		expect(shouldHandleNavigationClick(click, anchor, currentLocation)).toBe(true);
		expect(
			shouldHandleNavigationClick(
				{ ...click, metaKey: true } as MouseEvent,
				anchor,
				currentLocation,
			),
		).toBe(false);
		anchor.href = 'https://elsewhere.example/read';
		expect(shouldHandleNavigationClick(click, anchor, currentLocation)).toBe(false);
	});
});
