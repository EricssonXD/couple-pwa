/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// DuoSync service worker — Phase 0 stub.
// Responsibilities (filled in over later phases):
//   - Pre-cache app shell assets at install (offline-first)
//   - Network-first for API, cache-first for static
//   - Web Push handler (Phase 6)
//   - Background sync for queued location pings / messages
//
// SvelteKit auto-builds this file when present and ships it as /service-worker.js.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const CACHE = `duosync-v${version}`;
const ASSETS = [...build, ...files];

sw.addEventListener('install', (event) => {
	event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
	sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
	);
	sw.clients.claim();
});

sw.addEventListener('fetch', (event) => {
	const { request } = event;
	if (request.method !== 'GET') return;

	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;

	// Cache-first for built assets and static files.
	if (ASSETS.includes(url.pathname)) {
		event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
		return;
	}

	// Network-first for everything else, falling back to cache when offline.
	event.respondWith(
		fetch(request)
			.then((response) => {
				if (response.ok) {
					const copy = response.clone();
					caches.open(CACHE).then((cache) => cache.put(request, copy));
				}
				return response;
			})
			.catch(() => caches.match(request).then((c) => c ?? Response.error()))
	);
});

// Web Push handler stub — Phase 6 will fill this in with VAPID payload parsing.
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
