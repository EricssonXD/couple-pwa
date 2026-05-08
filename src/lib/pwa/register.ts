// Registers the SvelteKit-generated service worker and notifies the UI when an
// update is available so the app can prompt for reload.
// Vite-build-only: SvelteKit emits /service-worker.js automatically; in dev
// we deliberately skip registration to avoid stale caches during HMR.

import { dev } from '$app/environment';

export type SwUpdateState = 'idle' | 'update-available' | 'controller-changed';

let listeners = new Set<(s: SwUpdateState) => void>();
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

	// CRITICAL: only reload AFTER the new SW finishes activating. We
	// removed clients.claim() to avoid the auto-reload loop, which means
	// `controllerchange` does NOT fire from skipWaiting() alone — the
	// reload IS the activation handoff. If we reload before the new SW
	// is 'activated', the new page boots controlled by the OLD SW with
	// the new one still in 'installed' (waiting) → banner reappears
	// immediately and the user is stuck in a "click does nothing" loop.
	worker.addEventListener('statechange', () => {
		if (worker.state === 'activated') reloadOnce();
	});
	worker.postMessage('SKIP_WAITING');

	// Long-tail safety net only — if the message is dropped entirely
	// (SW died, browser swallowed it, etc.), reload after 10s so the
	// click is never permanently silent. The shared `reloading` flag
	// guarantees we still reload at most once.
	setTimeout(reloadOnce, 10000);
}

export async function registerServiceWorker(): Promise<void> {
	if (dev) return;
	if (typeof window === 'undefined') return;
	if (!('serviceWorker' in navigator)) return;

	try {
		const reg = await navigator.serviceWorker.register('/service-worker.js', {
			type: 'module',
			scope: '/'
		});
		registration = reg;

		const trackInstall = (worker: ServiceWorker | null) => {
			if (!worker) return;
			worker.addEventListener('statechange', () => {
				if (worker.state === 'installed' && navigator.serviceWorker.controller) {
					waitingWorker = worker;
					emit('update-available');
				}
			});
		};

		if (reg.waiting) {
			waitingWorker = reg.waiting;
			emit('update-available');
		}
		trackInstall(reg.installing);
		reg.addEventListener('updatefound', () => trackInstall(reg.installing));

		// Fires when the user accepts an update via applySwUpdate(). With
		// install-time skipWaiting + activate-time clients.claim removed
		// from the SW, this event ONLY happens after a user gesture, so a
		// reload here never interrupts the user mid-interaction.
		navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
	} catch (err) {
		console.warn('[duosync] SW registration failed', err);
	}
}
