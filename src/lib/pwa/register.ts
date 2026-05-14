// Registers the SvelteKit-generated service worker and silently rolls every
// open client onto the newest deploy at the next navigation boundary.
//
// Update model (auto-update, no banner):
//   1. registerServiceWorker() registers /service-worker.js with
//      `updateViaCache: 'none'` and starts a lightweight update poller
//      (visibility-aware: every 60s while the tab is visible, plus an
//      immediate check whenever it returns to foreground).
//   2. When the browser detects a new SW byte-diff and finishes installing
//      it, we observe `state === 'installed' && navigator.serviceWorker
//      .controller != null` and arm a module-level `pendingUpdate` flag.
//      We do NOT show a banner and do NOT auto-reload — the user keeps
//      whatever they're typing.
//   3. The +layout.svelte beforeNavigate hook calls hasPendingUpdate(); if
//      armed AND the navigation is internal, it cancels the navigation and
//      hands control to applyPendingUpdate(targetUrl), which posts
//      SKIP_WAITING (the SW message handler does both skipWaiting() AND
//      clients.claim()), awaits controllerchange, then performs a hard
//      navigation to the original URL so the new SW serves the page.
//
// Why navigation-time and not arrival-time / timer-driven?
//   - Mid-form auto-reload destroys user data (a moment being typed, an
//     unsent chat, a partially-filled onboarding step).
//   - Navigation is already a context switch — the user is leaving the
//     current view, so a one-off hard load is invisible UX-wise.
//   - The browser cache + SWR shell make the upgrade feel instant.
//
// Vite-build-only: SvelteKit emits /service-worker.js automatically; in
// dev we deliberately skip registration to avoid stale caches during HMR.

import { dev } from '$app/environment';

let registration: ServiceWorkerRegistration | null = null;
let pendingUpdate = false;
// Single-flight guard so a flurry of rapid clicks during apply can't fire
// multiple controllerchange listeners or multiple location.assign() calls.
let applying = false;

const POLL_INTERVAL_MS = 60_000;
// Hard cap on waiting for controllerchange after SKIP_WAITING. Above this
// we ship the user to the target URL anyway and trust the next reload to
// pick up the new SW; never strand the user mid-click.
const APPLY_TIMEOUT_MS = 5_000;

export function hasPendingUpdate(): boolean {
	return pendingUpdate;
}

// Same scriptURL guard used previously: protects against a flaky CDN
// re-serving the same SW build under "updatefound" (we don't want to
// trigger an apply→reload→apply loop in that case).
function isSameAsController(worker: ServiceWorker | null): boolean {
	const controllerScript = navigator.serviceWorker.controller?.scriptURL ?? null;
	return !!worker && !!controllerScript && worker.scriptURL === controllerScript;
}

function trackInstall(worker: ServiceWorker | null): void {
	if (!worker) return;
	worker.addEventListener('statechange', () => {
		if (worker.state !== 'installed') return;
		// First-ever install (no controller yet): the browser activates
		// immediately on its own; nothing to arm.
		if (!navigator.serviceWorker.controller) return;
		if (isSameAsController(worker)) return;
		pendingUpdate = true;
	});
}

/**
 * Apply the waiting service worker (if any) and then navigate to `targetUrl`.
 *
 * Posts SKIP_WAITING to the waiting worker — the SW message handler
 * skipWaiting()s AND clients.claim()s. We await `controllerchange` (which
 * only fires once the new SW becomes the page's controller) and then issue
 * a fresh hard navigation so the loaded HTML, JS, and __data.json all come
 * from the new bundle.
 *
 * If there's nothing waiting (caller raced an already-applied update), we
 * fall back to a simple navigation. If `controllerchange` doesn't arrive
 * within APPLY_TIMEOUT_MS we navigate anyway — better stale than stuck.
 */
export async function applyPendingUpdate(targetUrl: string): Promise<void> {
	if (applying) return;
	applying = true;
	pendingUpdate = false;

	const reg = registration ?? (await navigator.serviceWorker.getRegistration()) ?? null;
	const worker = reg?.waiting ?? null;

	if (!worker) {
		window.location.assign(targetUrl);
		return;
	}

	await new Promise<void>((resolve) => {
		let settled = false;
		const done = () => {
			if (settled) return;
			settled = true;
			resolve();
		};
		navigator.serviceWorker.addEventListener('controllerchange', done, { once: true });
		worker.postMessage('SKIP_WAITING');
		setTimeout(done, APPLY_TIMEOUT_MS);
	});

	window.location.assign(targetUrl);
}

function startUpdatePolling(reg: ServiceWorkerRegistration): void {
	const check = () => {
		// Only poll while the tab is in the foreground; background polling
		// burns battery and rarely sees updates that the user can act on.
		if (document.visibilityState !== 'visible') return;
		void reg.update().catch(() => {
			/* offline / network blip — try again next interval */
		});
	};
	setInterval(check, POLL_INTERVAL_MS);
	document.addEventListener('visibilitychange', check);
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
			// for updates. Default 'imports' would still allow the main SW
			// script to be served from HTTP cache subject to its own headers.
			// Belt-and-suspenders: a `Cache-Control: no-cache` on
			// /service-worker.js in `_headers` guarantees every update check
			// sees the canonical SW for the current deploy.
			updateViaCache: 'none'
		});
		registration = reg;

		// If we boot up and a SW is already waiting (user opened a stale
		// tab after a deploy that finished while they were away), arm the
		// flag so the very next navigation auto-applies it.
		if (reg.waiting && !isSameAsController(reg.waiting)) {
			pendingUpdate = true;
		}

		trackInstall(reg.installing);
		reg.addEventListener('updatefound', () => trackInstall(reg.installing));

		startUpdatePolling(reg);
	} catch (err) {
		console.warn('[duosync] SW registration failed', err);
	}
}

// Asks the controlling SW to drop HTML_CACHE + IMG_CACHE so the next paint
// can't surface the just-signed-out user's data on a shared device. Resolves
// when the SW confirms (or after a 1s timeout if the SW is unresponsive —
// privacy is best-effort, we never want sign-out to hang). Safe to call
// when no SW is registered.
export async function purgeUserCaches(): Promise<void> {
	if (typeof navigator === 'undefined') return;
	if (!('serviceWorker' in navigator)) return;
	const controller = navigator.serviceWorker.controller;
	if (!controller) {
		// First visit / SW not yet controlling: fall back to a direct
		// CacheStorage wipe of the same caches the SW would clear. Names
		// are versioned (duosync-html-v<version>) so we match by prefix.
		if (typeof caches === 'undefined') return;
		try {
			const keys = await caches.keys();
			await Promise.all(
				keys
					.filter((k) => k.startsWith('duosync-html-') || k.startsWith('duosync-img-'))
					.map((k) => caches.delete(k))
			);
		} catch {
			/* private mode / quota — best-effort */
		}
		return;
	}
	await new Promise<void>((resolve) => {
		const channel = new MessageChannel();
		const done = () => resolve();
		channel.port1.onmessage = done;
		setTimeout(done, 1000);
		controller.postMessage('PURGE_USER_CACHES', [channel.port2]);
	});
}
