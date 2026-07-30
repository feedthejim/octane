import {
	createPortal,
	flushSync,
	preconnect,
	prefetchDNS,
	preinit,
	preload,
	requestFormReset,
} from 'octane';

const noop = () => {};

export const __DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE = {
	d: {
		D: prefetchDNS,
		C: preconnect,
		L: preload,
		m: noop,
		X: preinit,
		S: noop,
	},
};

const ReactDOM = {
	__DOM_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE,
	createPortal,
	flushSync,
	preconnect,
	prefetchDNS,
	preinit,
	preload,
	requestFormReset,
};

export default ReactDOM;
export { createPortal, flushSync, preconnect, prefetchDNS, preinit, preload, requestFormReset };
