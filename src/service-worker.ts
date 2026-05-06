/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// DuoSync service worker — offline-first PWA.
//
// Strategy:
//   - Pre-cache the app shell (hashed `build` assets, static `files`,
//     plus the offline fallback page) at install.
//   - Hashed build assets → cache-first, immutable.
//   - Static files → cache-first.
//   - HTML navigations → network-first, fall back to cached HTML, then
//     to /offline as a last resort.
//   - Images (own origin) → stale-while-revalidate with a small LRU cap.
//   - Never cache /api/* or /auth/* — these hold private session data
//     and must not be served stale or to the wrong user.
//   - Never cache non-GET, non-2xx, opaque, or cross-origin requests.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL_CACHE = `duosync-shell-v${version}`;
const HTML_CACHE = `duosync-html-v${version}`;
const IMG_CACHE = `duosync-img-v${version}`;
const RUNTIME_CACHES = new Set([SHELL_CACHE, HTML_CACHE, IMG_CACHE]);

const OFFLINE_URL = '/offline';
const SHELL_ASSETS = [...build, ...files, OFFLINE_URL];
const SHELL_SET = new Set(SHELL_ASSETS);

const IMG_CACHE_MAX = 60;

function isPrivatePath(pathname: string): boolean {
	return (
		pathname.startsWith('/api/') || pathname.startsWith('/auth/') || pathname.startsWith('/ws/')
	);
}

// SvelteKit issues data requests at /__data.json or /<route>/__data.json
// during SPA navigation. Treat them like HTML so the cached page works
// fully offline (network-first, cache fallback, no /offline rewrite since
// data files aren't HTML).
function isDataRequest(pathname: string): boolean {
	return pathname.endsWith('/__data.json') || pathname.includes('/__data.json?');
}

async function trimCache(cacheName: string, max: number): Promise<void> {
	const cache = await caches.open(cacheName);
	const keys = await cache.keys();
	if (keys.length <= max) return;
	for (const k of keys.slice(0, keys.length - max)) await cache.delete(k);
}

sw.addEventListener('install', (event) => {
	event.waitUntil(
		caches.open(SHELL_CACHE).then((cache) =>
			// addAll fails atomically — guard the offline fallback so a missing
			// route doesn't block the whole install.
			cache.addAll(SHELL_ASSETS).catch(async () => {
				for (const asset of SHELL_ASSETS) {
					try {
						await cache.add(asset);
					} catch {
						/* swallow */
					}
				}
			})
		)
	);
	sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(keys.filter((k) => !RUNTIME_CACHES.has(k)).map((k) => caches.delete(k)))
			)
			.then(() => sw.clients.claim())
	);
});

sw.addEventListener('message', (event) => {
	if (event.data === 'SKIP_WAITING') sw.skipWaiting();
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;
	if (isPrivatePath(url.pathname)) return;

	// 1) Hashed build + static files → cache-first.
	if (SHELL_SET.has(url.pathname)) {
		event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
		return;
	}

	// 2) HTML navigations + SvelteKit __data.json → network-first w/ offline fallback.
	const isHtml =
		request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html');
	const isData = isDataRequest(url.pathname);
	if (isHtml || isData) {
		event.respondWith(
			(async () => {
				try {
					const response = await fetch(request);
					if (response.ok && response.type === 'basic') {
						const copy = response.clone();
						const cache = await caches.open(HTML_CACHE);
						cache.put(request, copy);
					}
					return response;
				} catch {
					const cached = await caches.match(request);
					if (cached) return cached;
					if (isHtml) {
						const offline = await caches.match(OFFLINE_URL);
						if (offline) return offline;
					}
					return Response.error();
				}
			})()
		);
		return;
	}

	// 3) Images → stale-while-revalidate.
	if (request.destination === 'image') {
		event.respondWith(
			(async () => {
				const cache = await caches.open(IMG_CACHE);
				const cached = await cache.match(request);
				const network = fetch(request)
					.then((response) => {
						if (response.ok) {
							cache.put(request, response.clone());
							trimCache(IMG_CACHE, IMG_CACHE_MAX);
						}
						return response;
					})
					.catch(() => cached);
				return cached ?? network;
			})()
		);
		return;
	}

	// 4) Everything else (scripts/styles/json from this origin) → SWR.
	event.respondWith(
		(async () => {
			const cache = await caches.open(SHELL_CACHE);
			const cached = await cache.match(request);
			const network = fetch(request)
				.then((response) => {
					if (response.ok && response.type === 'basic') {
						cache.put(request, response.clone());
					}
					return response;
				})
				.catch(() => cached);
			return cached ?? network;
		})()
	);
});

// Web Push handler — Phase 6 will fill in payload contracts.
sw.addEventListener('push', (event) => {
	if (!event.data) return;
	const data = (() => {
		try {
			return event.data!.json() as { title?: string; body?: string; url?: string };
		} catch {
			return { title: 'DuoSync', body: event.data!.text() };
		}
	})();

	event.waitUntil(
		sw.registration.showNotification(data.title ?? 'DuoSync', {
			body: data.body,
			icon: '/icon-192.png',
			badge: '/icon-192.png',
			data: { url: data.url ?? '/' }
		})
	);
});

sw.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const target = (event.notification.data as { url?: string })?.url ?? '/';
	event.waitUntil(
		sw.clients.matchAll({ type: 'window' }).then((clients) => {
			const existing = clients.find((c) => c.url.includes(target));
			if (existing) return existing.focus();
			return sw.clients.openWindow(target);
		})
	);
});
