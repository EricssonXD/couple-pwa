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
	worker?.postMessage('SKIP_WAITING');

	// Safety net: if controllerchange doesn't fire within 1.5s (waiting
	// worker already gone, browser swallowed the message, etc.), force a
	// reload so the click is never silent. The shared `reloading` flag
	// guarantees we still only reload once.
	setTimeout(reloadOnce, 1500);
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
