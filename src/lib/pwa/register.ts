// Registers the SvelteKit-generated service worker and notifies the UI when an
// update is available so the app can prompt for reload.
// Vite-build-only: SvelteKit emits /service-worker.js automatically; in dev
// we deliberately skip registration to avoid stale caches during HMR.

import { dev } from '$app/environment';

export type SwUpdateState = 'idle' | 'update-available' | 'controller-changed';

let listeners = new Set<(s: SwUpdateState) => void>();
let waitingWorker: ServiceWorker | null = null;

export function onSwUpdate(fn: (s: SwUpdateState) => void): () => void {
	listeners.add(fn);
	return () => listeners.delete(fn);
}

function emit(state: SwUpdateState) {
	for (const fn of listeners) fn(state);
}

export function applySwUpdate(): void {
	waitingWorker?.postMessage('SKIP_WAITING');
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

		// When the user accepts the update we postMessage SKIP_WAITING; the new
		// worker takes control and fires controllerchange. We reload once.
		let reloaded = false;
		navigator.serviceWorker.addEventListener('controllerchange', () => {
			if (reloaded) return;
			reloaded = true;
			emit('controller-changed');
			window.location.reload();
		});

		// Periodic update check while the tab is open.
		setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
	} catch (err) {
		console.warn('[duosync] SW registration failed', err);
	}
}
