/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

// DuoSync service worker — offline-first PWA.
//
// Strategy:
//   - Pre-cache the app shell (hashed `build` assets, static `files`,
//     plus the offline fallback page) at install.
//   - Warm the HTML cache for core routes (/pulse, /map, /moments,
//     /settings, /) at install — best-effort, never blocks activation.
//     This makes cold launch from the home screen feel native (no
//     network spinner) when those routes have been cached previously.
//   - Hashed build assets → cache-first, immutable.
//   - Static files → cache-first.
//   - HTML navigations + SvelteKit __data.json → stale-while-revalidate.
//     Cache wins instantly on every tab switch (native-feel response,
//     no 1s network round-trip), then we refresh in the background so
//     the next visit sees fresh content. First-ever visit to a route
//     waits on the network (or navigation preload, which started in
//     parallel); afterwards: instant. Falls back to /offline only on
//     a cache miss + network failure. HTML cache trimmed to MAX entries.
//   - Images (own origin) → stale-while-revalidate with a small LRU cap.
//   - Never cache /api/* or /auth/* — these hold private session data
//     and must not be served stale or to the wrong user.
//   - Never cache non-GET, non-2xx, opaque, or cross-origin requests.
//
// Update-flow contract (do NOT change without updating
// `$lib/pwa/register.ts`):
//   - install does NOT call skipWaiting. New SW stays in 'installed'
//     state until the user clicks the UpdateBanner.
//   - activate does NOT call clients.claim. We do NOT want every deploy
//     to auto-reload every open tab.
//   - UI posts 'SKIP_WAITING' on user gesture (string, matches the
//     equality check below). The message handler then calls BOTH
//     skipWaiting() AND clients.claim() — the latter is the user-opt-in
//     handoff that makes the new SW the controller. clients.claim() is
//     what causes `controllerchange` to fire on the page; register.ts
//     listens for that and reloads exactly once.
//   - Without claim() at SKIP_WAITING time, in installed-PWA / standalone
//     contexts the page can reload while the OLD SW is still controller
//     and observe the new SW as still "waiting" → banner re-emits in a
//     loop. Empirically observed on iOS/Android home-screen installs.
//   - SWR HTML strategy means the user might see one stale paint after
//     a deploy before the UpdateBanner appears — acceptable trade for
//     native-feel tab switches.

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;

const SHELL_CACHE = `duosync-shell-v${version}`;
const HTML_CACHE = `duosync-html-v${version}`;
const IMG_CACHE = `duosync-img-v${version}`;
const RUNTIME_CACHES = new Set([SHELL_CACHE, HTML_CACHE, IMG_CACHE]);

const OFFLINE_URL = '/offline';
const SHELL_ASSETS = [...build, ...files, OFFLINE_URL];
const SHELL_SET = new Set(SHELL_ASSETS);

// Routes warmed at install so the home-screen launch paints from cache
// even on a cold network. These must be public (no auth wall) OR be
// fine returning the unauthenticated SSR variant — which is true here
// because protected routes redirect at the route handler, not in HTML.
// `/` is a redirect-only stub; `/welcome` is the cacheable marketing
// page anonymous users land on. `/auth/sign-in` and `/onboarding` are
// warmed so a logged-out / mid-onboarding user opening the PWA offline
// still gets a usable page instead of the offline fallback (R3).
const WARM_ROUTES = [
	'/',
	'/welcome',
	'/auth/sign-in',
	'/onboarding',
	'/pulse',
	'/map',
	'/moments',
	'/settings'
];

const HTML_CACHE_MAX = 24;
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
		(async () => {
			const cache = await caches.open(SHELL_CACHE);
			// addAll fails atomically — guard the offline fallback so a missing
			// route doesn't block the whole install.
			try {
				await cache.addAll(SHELL_ASSETS);
			} catch {
				for (const asset of SHELL_ASSETS) {
					try {
						await cache.add(asset);
					} catch {
						/* swallow */
					}
				}
			}

			// Best-effort warm of core HTML routes. Never throws — if the
			// network is unreachable at install (common on first run from a
			// flaky connection), the routes simply remain uncached and will
			// be fetched on first navigation. Fetch with `cache: 'no-store'`
			// so we don't poison the HTTP cache, then store the response
			// ourselves in HTML_CACHE.
			const htmlCache = await caches.open(HTML_CACHE);
			await Promise.all(
				WARM_ROUTES.map(async (route) => {
					try {
						const res = await fetch(route, {
							cache: 'no-store',
							credentials: 'omit',
							redirect: 'manual'
						});
						if (res.ok && res.type === 'basic') {
							await htmlCache.put(route, res);
						}
					} catch {
						/* offline at install — fine */
					}
				})
			);
		})()
	);
	// Do NOT call sw.skipWaiting() here. We want the lifecycle's natural
	// wait state so the UI can show an UpdateBanner before activating —
	// otherwise every deploy auto-reloads the user's tab mid-interaction
	// (combined with the controllerchange→reload handler in
	// $lib/pwa/register.ts). First install has no previous SW so the
	// browser activates immediately; subsequent installs wait for the
	// user to click "Reload" which posts SKIP_WAITING (see message
	// handler below).
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			// Enable Navigation Preload so the network fetch starts in
			// parallel with SW boot on every navigation. Significant TTFB
			// win on cold SW starts; harmless where unsupported.
			if ('navigationPreload' in sw.registration) {
				try {
					await sw.registration.navigationPreload.enable();
				} catch {
					/* unsupported */
				}
			}

			const keys = await caches.keys();
			await Promise.all(keys.filter((k) => !RUNTIME_CACHES.has(k)).map((k) => caches.delete(k)));

			// Do NOT call sw.clients.claim(). That would trigger a
			// controllerchange event on the page, which the registration
			// helper turns into a forced location.reload(). The user has
			// either just reloaded (after pressing the UpdateBanner
			// button) or this is a first install with no prior controller
			// — in both cases the natural lifecycle is correct without
			// claim().
		})()
	);
});

sw.addEventListener('message', (event) => {
	if (event.data === 'SKIP_WAITING') {
		// User-gesture handoff. Two-step:
		//   1) skipWaiting() → this SW transitions installed → activating → activated.
		//   2) clients.claim() → this SW becomes the controller of all open clients,
		//      which fires `controllerchange` on the page so register.ts can reload
		//      from a known-good "new SW is in control" state.
		// We deliberately gate claim() behind this user-gesture message rather than
		// calling it in the activate handler — that would auto-reload every tab on
		// every deploy (the loop we removed). Here it's safe: the page just asked
		// for the update.
		event.waitUntil(
			(async () => {
				await sw.skipWaiting();
				await sw.clients.claim();
			})()
		);
		return;
	}

	if (event.data === 'PURGE_USER_CACHES') {
		// Shared-device privacy: when a user signs out we drop every cache
		// that could surface their data. SHELL_CACHE is kept because it
		// only holds hashed build assets + the public /offline page —
		// nothing user-scoped. HTML_CACHE / IMG_CACHE may hold rendered
		// pages with personal content (their partner's name, photos,
		// daily-question answers) so we wipe them outright. The page
		// posting this message is responsible for awaiting the
		// MessagePort reply before navigating away, so the next user's
		// first paint can't pull a stale cached HTML.
		const port = event.ports[0];
		event.waitUntil(
			(async () => {
				await Promise.all([caches.delete(HTML_CACHE), caches.delete(IMG_CACHE)]);
				port?.postMessage({ ok: true });
			})()
		);
		return;
	}
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

	// 2) HTML navigations + SvelteKit __data.json → stale-while-revalidate.
	//    Cached page paints instantly; network refreshes in the background
	//    so the next visit sees fresh content. First-ever visit waits on
	//    the network (which is what the user would have done anyway).
	const isHtml =
		request.mode === 'navigate' || request.headers.get('accept')?.includes('text/html');
	const isData = isDataRequest(url.pathname);
	if (isHtml || isData) {
		event.respondWith(
			(async () => {
				const cache = await caches.open(HTML_CACHE);
				const cached = await cache.match(request);

				const network = (async () => {
					try {
						// Use the navigation-preload response if available — it
						// began before this fetch handler ran.
						const preload =
							isHtml && 'preloadResponse' in event
								? await (event as FetchEvent).preloadResponse
								: undefined;
						const response = preload ?? (await fetch(request));
						if (response.ok && response.type === 'basic') {
							const copy = response.clone();
							await cache.put(request, copy);
							trimCache(HTML_CACHE, HTML_CACHE_MAX);
						}
						return response;
					} catch {
						if (cached) return cached;
						if (isHtml) {
							const offline = await caches.match(OFFLINE_URL);
							if (offline) return offline;
						}
						return Response.error();
					}
				})();

				// SWR: serve cache instantly when present; let the network
				// fetch settle (and update the cache) in the background.
				if (cached) {
					event.waitUntil(network.catch(() => {}));
					return cached;
				}
				return network;
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

// R1: Background Sync — drain the offline write queue when the OS
// reports connectivity restored, even if the tab is closed. Mirrors
// the runtime contract in src/lib/client/offline-queue.ts: same DB
// name, same store name, same flush logic. iOS Safari + Firefox don't
// fire `sync` events; their drains happen from the foreground via
// installQueueRunner().
const QUEUE_DB = 'duosync-queue';
const QUEUE_STORE = 'pending';
const QUEUE_TAG = 'duosync-queue-flush';

interface QueuedReq {
	id?: number;
	endpoint: string;
	method: string;
	body: unknown;
	idempotencyKey: string;
	createdAt: number;
	attempts: number;
	nextAttemptAt: number;
	dead?: boolean;
}

function openQueue(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(QUEUE_DB, 1);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
		// No onupgradeneeded — the page already created the schema.
	});
}

async function drainQueueFromSw(): Promise<void> {
	let db: IDBDatabase;
	try {
		db = await openQueue();
	} catch {
		return; // queue never opened by the page yet — nothing to drain
	}
	const txRead = db.transaction(QUEUE_STORE, 'readonly');
	const all: QueuedReq[] = await new Promise((resolve, reject) => {
		const req = txRead.objectStore(QUEUE_STORE).getAll();
		req.onsuccess = () => resolve((req.result as QueuedReq[]).filter((e) => !e.dead));
		req.onerror = () => reject(req.error);
	});
	const now = Date.now();
	const due = all.filter((e) => e.nextAttemptAt <= now).sort((a, b) => a.createdAt - b.createdAt);
	for (const entry of due) {
		try {
			const res = await fetch(entry.endpoint, {
				method: entry.method,
				headers: {
					'content-type': 'application/json',
					'x-idempotency-key': entry.idempotencyKey
				},
				body: entry.body == null ? undefined : JSON.stringify(entry.body)
			});
			if (res.ok || (res.status >= 400 && res.status < 500)) {
				await new Promise<void>((resolve) => {
					const t = db.transaction(QUEUE_STORE, 'readwrite');
					t.objectStore(QUEUE_STORE).delete(entry.id!);
					t.oncomplete = () => resolve();
					t.onerror = () => resolve();
				});
			} else {
				// 5xx: leave it for the next sync (the foreground retry loop
				// owns backoff scheduling — we just delivered what was due).
			}
		} catch {
			// Network failed mid-drain — abort; OS will redeliver `sync`.
			return;
		}
	}
}

sw.addEventListener('sync', (event) => {
	const e = event as ExtendableEvent & { tag?: string };
	if (e.tag !== QUEUE_TAG) return;
	e.waitUntil(drainQueueFromSw());
});

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
