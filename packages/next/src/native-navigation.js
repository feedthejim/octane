const RESUME_MARKER = 'self.__next_client_reference_resume__=';
const DOCUMENT_CACHE_LIMIT = 20;

function readJsonValue(source, start) {
	let depth = 0;
	let quote = false;
	let escape = false;
	for (let index = start; index < source.length; index += 1) {
		const character = source[index];
		if (quote) {
			if (escape) escape = false;
			else if (character === '\\') escape = true;
			else if (character === '"') quote = false;
			continue;
		}
		if (character === '"') {
			quote = true;
			continue;
		}
		if (character === '[' || character === '{') depth += 1;
		if (character === ']' || character === '}') {
			depth -= 1;
			if (depth === 0) return source.slice(start, index + 1);
		}
	}
	return null;
}

export function readClientReferenceResumeEntries(nextDocument) {
	for (const script of nextDocument.scripts) {
		const source = script.textContent ?? '';
		const markerIndex = source.indexOf(RESUME_MARKER);
		if (markerIndex === -1) continue;
		const start = markerIndex + RESUME_MARKER.length;
		const json = readJsonValue(source, start);
		if (json !== null) return JSON.parse(json);
	}
	return [];
}

export function shouldHandleNavigationClick(event, anchor, currentLocation = location) {
	if (
		event.defaultPrevented ||
		event.button !== 0 ||
		event.metaKey ||
		event.ctrlKey ||
		event.shiftKey ||
		event.altKey ||
		anchor.hasAttribute('download') ||
		(anchor.target && anchor.target !== '_self') ||
		anchor.dataset.octaneReload !== undefined
	) {
		return false;
	}
	const url = new URL(anchor.href, currentLocation.href);
	if (url.origin !== currentLocation.origin || !/^https?:$/.test(url.protocol)) return false;
	if (
		url.pathname === currentLocation.pathname &&
		url.search === currentLocation.search &&
		url.hash
	) {
		return false;
	}
	return true;
}

function cloneNodeIntoDocument(node) {
	return document.importNode(node, true);
}

function synchronizeMetadata(nextDocument) {
	const selector = 'title,meta[name],meta[property],link[rel="canonical"],link[rel="alternate"]';
	for (const node of document.head.querySelectorAll(selector)) node.remove();
	for (const node of nextDocument.head.querySelectorAll(selector)) {
		document.head.appendChild(cloneNodeIntoDocument(node));
	}
}

async function installRouteStyles(nextDocument) {
	const existing = new Set(
		[...document.head.querySelectorAll('link[rel="stylesheet"][href]')].map((link) => link.href),
	);
	const pending = [];
	for (const source of nextDocument.head.querySelectorAll('link[rel="stylesheet"][href]')) {
		if (existing.has(source.href)) continue;
		const link = cloneNodeIntoDocument(source);
		pending.push(
			new Promise((resolve) => {
				link.addEventListener('load', resolve, { once: true });
				link.addEventListener('error', resolve, { once: true });
			}),
		);
		document.head.appendChild(link);
	}
	await Promise.all(pending);
}

function transitionTypesForAnchor(anchor) {
	const encoded = anchor?.dataset.octaneTransition;
	return encoded ? encoded.split(/\s+/).filter(Boolean) : [];
}

export function createNativeRouter({ activate, deactivate }) {
	const documents = new Map();
	let navigation;

	function remember(url, value) {
		documents.delete(url);
		documents.set(url, value);
		if (documents.size > DOCUMENT_CACHE_LIMIT) {
			documents.delete(documents.keys().next().value);
		}
		return value;
	}

	function loadDocument(url, { fresh = false } = {}) {
		const href = new URL(url, location.href).href;
		if (!fresh) {
			const cached = documents.get(href);
			if (cached !== undefined) return cached;
		}
		const request = fetch(href, {
			headers: { 'x-octane-navigation': '1' },
			credentials: 'same-origin',
			priority: 'high',
		}).then(async (response) => {
			if (!response.ok) throw new Error(`Navigation to ${href} failed with ${response.status}.`);
			return new DOMParser().parseFromString(await response.text(), 'text/html');
		});
		return remember(href, request);
	}

	async function commit(nextDocument, url, { replace, scroll }) {
		await installRouteStyles(nextDocument);
		deactivate();
		synchronizeMetadata(nextDocument);
		self.__next_client_reference_resume__ = readClientReferenceResumeEntries(nextDocument);
		document.body.replaceWith(cloneNodeIntoDocument(nextDocument.body));
		document.documentElement.lang = nextDocument.documentElement.lang;
		if (replace) history.replaceState(null, '', url);
		else history.pushState(null, '', url);
		if (scroll) window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
		await activate();
	}

	async function navigate(
		url,
		{ replace = false, scroll = true, transitionTypes = [], fresh = false } = {},
	) {
		const href = new URL(url, location.href).href;
		const current = navigation;
		const work = (async () => {
			document.dispatchEvent(
				new CustomEvent('octane:navigation-start', { detail: { href, transitionTypes } }),
			);
			const nextDocument = await loadDocument(href, { fresh });
			const update = () => commit(nextDocument, href, { replace, scroll });
			if (typeof document.startViewTransition === 'function') {
				const transition = document.startViewTransition(
					transitionTypes.length > 0 ? { update, types: transitionTypes } : update,
				);
				await transition.updateCallbackDone;
			} else {
				await update();
			}
			document.dispatchEvent(
				new CustomEvent('octane:navigation-complete', {
					detail: { href, transitionTypes },
				}),
			);
		})();
		navigation = work;
		try {
			await work;
		} catch (error) {
			if (navigation === work && current !== work) location.assign(href);
			throw error;
		} finally {
			if (navigation === work) navigation = undefined;
		}
	}

	function prefetch(url) {
		return loadDocument(url).then(() => undefined);
	}

	function click(event) {
		const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
		if (!(anchor instanceof HTMLAnchorElement) || !shouldHandleNavigationClick(event, anchor)) {
			return;
		}
		event.preventDefault();
		void navigate(anchor.href, {
			transitionTypes: transitionTypesForAnchor(anchor),
		}).catch((error) => console.error('[Octane Next navigation]', error));
	}

	function warm(event) {
		const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null;
		if (!(anchor instanceof HTMLAnchorElement)) return;
		const url = new URL(anchor.href, location.href);
		if (url.origin !== location.origin) return;
		void prefetch(url.href).catch(() => {});
	}

	function popstate() {
		void navigate(location.href, { replace: true, scroll: false }).catch((error) =>
			console.error('[Octane Next navigation]', error),
		);
	}

	document.addEventListener('click', click);
	document.addEventListener('pointerover', warm, { passive: true });
	document.addEventListener('focusin', warm);
	window.addEventListener('popstate', popstate);

	return {
		back: () => history.back(),
		forward: () => history.forward(),
		prefetch,
		push: (url, options) => navigate(url, options),
		refresh: () => navigate(location.href, { replace: true, scroll: false, fresh: true }),
		replace: (url, options) => navigate(url, { ...options, replace: true }),
	};
}
