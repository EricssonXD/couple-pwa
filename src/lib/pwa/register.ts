// Registers the SvelteKit-generated service worker and silently rolls every
// open client onto the newest deploy at the next navigation boundary —
// optionally surfacing a small UpdatePromptBanner for users who want to
// trigger the apply manually.
//
// Update model (auto-update at navigation, plus optional prompt):
//   1. registerServiceWorker() calls vite-plugin-pwa's `registerSW`
//      (virtual:pwa-register). vite-pwa wires the registration with
//      `updateViaCache: 'none'` semantics, observes `updatefound`, and
//      invokes our `onNeedRefresh` callback once a new SW reaches
//      'installed' state with a controller already present (i.e. not
//      the first install).
//   2. onNeedRefresh sets module-level `pendingUpdate=true` and pushes
//      `true` into the `needRefresh` Svelte store. The page can:
//        - Wait for the next navigation; the +layout.svelte
//          beforeNavigate hook calls hasPendingUpdate() and silently
//          swaps via applyPendingUpdate(targetUrl).
//        - OR render UpdatePromptBanner.svelte, which subscribes to
//          `needRefresh` and exposes a button to call
//          applyPendingUpdate(location.href) immediately.
//   3. applyPendingUpdate posts SKIP_WAITING (the SW handler does both
//      skipWaiting() AND clients.claim()), awaits controllerchange,
//      then performs a hard navigation to the target URL so the new
//      SW serves the page.
//
// Why not use vite-pwa's returned `updateServiceWorker(reload)` helper?
//   - It does the right thing for whole-page reloads (reload=true) or
//     fully manual flows (reload=false). We need to navigate to a
//     SPECIFIC URL captured by beforeNavigate, not just reload the
//     current page. So we keep the SKIP_WAITING + controllerchange
//     dance ourselves; vite-pwa just tells us *when* to start it.
//
// Vite-build-only: vite-plugin-pwa skips registration in dev (we have
// devOptions.enabled=false in vite.config.ts).

import { dev } from '$app/environment';
import { writable, type Writable } from 'svelte/store';
import { registerSW } from 'virtual:pwa-register';

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

// UpdatePromptBanner.svelte subscribes to this. `true` once the SW
// reports a waiting update; flipped back to `false` when the user (or
// the navigation hook) applies it.
export const needRefresh: Writable<boolean> = writable(false);

export function hasPendingUpdate(): boolean {
	return pendingUpdate;
}

function armPending(): void {
	pendingUpdate = true;
	needRefresh.set(true);
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
 * fall back to a simple reload/navigation. If `controllerchange` doesn't
 * arrive within APPLY_TIMEOUT_MS we navigate anyway — better stale than
 * stuck.
 *
 * Reload semantics: when targetUrl matches the current page we MUST call
 * `location.reload()` rather than `location.assign(currentUrl)`. iOS Safari
 * (and intermittently Chrome Android) treats assign-to-self as a no-op
 * which is why the "Reload" pill silently did nothing for some users.
 */
export async function applyPendingUpdate(targetUrl: string): Promise<void> {
	if (applying) return;
	applying = true;
	pendingUpdate = false;
	needRefresh.set(false);

	const finish = (): void => {
		const here = typeof window !== 'undefined' ? window.location.href.split('#')[0] : '';
		const target = targetUrl.split('#')[0];
		if (target === here) {
			window.location.reload();
		} else {
			window.location.assign(targetUrl);
		}
	};

	try {
		const reg = registration ?? (await navigator.serviceWorker.getRegistration()) ?? null;
		const worker = reg?.waiting ?? null;

		if (!worker) {
			finish();
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

		finish();
	} catch (err) {
		// Never strand the user mid-click: release the single-flight lock
		// so they can try again, and surface the failure for diagnostics.
		console.warn('[duosync] applyPendingUpdate failed', err);
		applying = false;
		pendingUpdate = true;
		needRefresh.set(true);
	}
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
		registerSW({
			immediate: true,
			onNeedRefresh() {
				// vite-pwa fires this when a new SW has reached the
				// 'installed' state with a controller already in place
				// (i.e. it's an update, not the first install).
				armPending();
			},
			onRegisteredSW(_swUrl, reg) {
				if (!reg) return;
				registration = reg;

				// If we boot up and a SW is already waiting (user opened
				// a stale tab after a deploy that finished while they
				// were away), arm the flag so the next navigation
				// auto-applies it AND the prompt banner can render.
				if (reg.waiting && navigator.serviceWorker.controller) {
					armPending();
				}

				startUpdatePolling(reg);
			},
			onRegisterError(err) {
				console.warn('[duosync] SW registration failed', err);
			}
		});
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
