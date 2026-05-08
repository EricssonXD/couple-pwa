// Registers the SvelteKit-generated service worker and notifies the UI when an
// update is available so the app can prompt for reload.
// Vite-build-only: SvelteKit emits /service-worker.js automatically; in dev
// we deliberately skip registration to avoid stale caches during HMR.

import { dev } from '$app/environment';

export type SwUpdateState = 'idle' | 'update-available' | 'controller-changed';

const listeners = new Set<(s: SwUpdateState) => void>();
let waitingWorker: ServiceWorker | null = null;
let registration: ServiceWorkerRegistration | null = null;
// Single source of truth so the controllerchange handler and the safety-net
// timer in applySwUpdate can't fire location.reload() twice (which would loop
// briefly and waste a fetch on slow connections).
let reloading = false;

export function onSwUpdate(fn: (s: SwUpdateState) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function emit(state: SwUpdateState) {
	for (const fn of listeners) fn(state);
}

function reloadOnce(): void {
	if (reloading) return;
	reloading = true;
	emit('controller-changed');
	window.location.reload();
}

export async function applySwUpdate(): Promise<void> {
	// Always re-read the current waiting worker from the live registration —
	// the cached `waitingWorker` reference may be stale (e.g. a newer SW
	// replaced it and made the cached one 'redundant', which makes
	// skipWaiting a no-op and the user's click feel broken).
	const reg = registration ?? (await navigator.serviceWorker.getRegistration()) ?? null;
	const worker = reg?.waiting ?? waitingWorker;

	// If there's nothing to activate, just reload — best-effort recovery
	// so the click is never silent.
	if (!worker) {
		reloadOnce();
		return;
	}

	// Already activated (we missed the transition somehow): reload now.
	if (worker.state === 'activated') {
		reloadOnce();
		return;
	}

	// Post SKIP_WAITING — the SW message handler will skipWaiting() AND
	// clients.claim(). The claim is what causes `controllerchange` to
	// fire on this page, and the page-level controllerchange listener
	// (registered in registerServiceWorker below) calls reloadOnce().
	//
	// Why claim at gesture time instead of relying on statechange? In
	// installed-PWA / standalone contexts, a location.reload() fired off
	// the worker's 'activated' statechange can race the activation
	// handoff: the reloaded page boots while the OLD SW is still the
	// controller, and from that page's perspective the new SW still
	// looks "waiting" → the UpdateBanner re-emits immediately and the
	// user is stuck in a loop. Waiting for controllerchange — which only
	// fires after claim() — guarantees the new SW is the controller
	// before we reload. claim() is gated on the user gesture (this
	// SKIP_WAITING message), so it does NOT cause auto-reload loops on
	// every deploy.
	//
	// We still register a statechange→'activated' listener as a defensive
	// fallback in case claim() fails or controllerchange is dropped.
	worker.addEventListener('statechange', () => {
		if (worker.state === 'activated') reloadOnce();
	});
	worker.postMessage('SKIP_WAITING');

	// Long-tail safety net only — if both the message AND controllerchange
	// are dropped entirely (SW died, browser swallowed it, etc.), reload
	// after 10s so the click is never permanently silent. The shared
	// `reloading` flag guarantees we still reload at most once.
	setTimeout(reloadOnce, 10000);
}

export async function registerServiceWorker(): Promise<void> {
	if (dev) return;
	if (typeof window === 'undefined') return;
	if (!('serviceWorker' in navigator)) return;

	try {
		const reg = await navigator.serviceWorker.register('/service-worker.js', {
			type: 'module',
			scope: '/',
			// Bypass the HTTP cache when the browser checks /service-worker.js
			// for updates. Default is 'imports', which still allows the main
			// SW script to be served from HTTP cache subject to its
			// Cache-Control headers. We belt-and-suspenders this with a
			// `Cache-Control: no-cache` entry in `_headers` for /service-worker.js
			// — together they guarantee every update check sees the canonical
			// SW for the current deploy and never an edge-cached older copy
			// (which was the root cause of the UpdateBanner re-emit loop on
			// Cloudflare).
			updateViaCache: 'none'
		});
		registration = reg;

		// Defensive guard: don't re-emit "update-available" for a worker we
		// already activated this page-load. After a successful update flow
		// (SKIP_WAITING → claim → reload), the new SW is the controller and
		// reg.waiting should be null. If a flaky CDN serves *yet another*
		// SW build on the very next update-check, we'd loop again. Tracking
		// the activated scriptURL gives us a kill-switch: same script ⇒
		// stay quiet. Different script ⇒ legitimate new deploy, banner OK.
		const controllerScript = navigator.serviceWorker.controller?.scriptURL ?? null;
		const isSameAsController = (w: ServiceWorker | null) =>
			!!w && !!controllerScript && w.scriptURL === controllerScript;

		const trackInstall = (worker: ServiceWorker | null) => {
			if (!worker) return;
			worker.addEventListener('statechange', () => {
				if (worker.state === 'installed' && navigator.serviceWorker.controller) {
					if (isSameAsController(worker)) return;
					waitingWorker = worker;
					emit('update-available');
				}
			});
		};

		if (reg.waiting && !isSameAsController(reg.waiting)) {
			waitingWorker = reg.waiting;
			emit('update-available');
		}
		trackInstall(reg.installing);
		reg.addEventListener('updatefound', () => trackInstall(reg.installing));

		// Fires when the new SW becomes the controller of this page,
		// which happens when the SW message handler calls clients.claim()
		// in response to the SKIP_WAITING gesture. With install-time
		// skipWaiting AND activate-time clients.claim removed from the
		// SW, this event ONLY happens after a user gesture, so a reload
		// here never interrupts the user mid-interaction.
		navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
	} catch (err) {
		console.warn('[duosync] SW registration failed', err);
	}
}
