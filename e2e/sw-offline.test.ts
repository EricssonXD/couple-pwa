import { expect, test } from '@playwright/test';

// Verifies the production service worker actually delivers the offline-first
// promise documented in src/service-worker.ts:
//
//   1. Registers + activates against `bun run preview` (the same Cloudflare
//      worker bundle users get).
//   2. Warms the HTML cache for `/` (the only WARM_ROUTE we can reliably
//      reach unauthenticated — /pulse etc. redirect to /auth/* which is
//      explicitly NOT cached).
//   3. Drops the network and re-paints `/` from cache.
//   4. Navigates to an uncached non-private route while offline and confirms
//      the SW falls back to /offline rather than a network-error page.
//
// Service workers are intentionally NOT blocked here. The cross-page
// navigation race documented in playwright.prod.config.ts is avoided by
// only reloading the same page and by using a fresh context per test so
// no leftover SW state spans tests.

test.use({ serviceWorkers: 'allow' });

async function waitForSwActive(page: import('@playwright/test').Page) {
	// Wait for the SW to reach the 'activated' state. Note: register.ts does
	// NOT call clients.claim() outside the SKIP_WAITING gesture, so on the
	// very first visit `navigator.serviceWorker.controller` is null even
	// after activation. The caller must reload (or navigate) once before the
	// page is actually controlled.
	await page.waitForFunction(
		async () => {
			if (!('serviceWorker' in navigator)) return false;
			const reg = await navigator.serviceWorker.ready;
			return reg.active?.state === 'activated';
		},
		undefined,
		{ timeout: 15_000 }
	);
}

async function waitForController(page: import('@playwright/test').Page) {
	await page.waitForFunction(() => !!navigator.serviceWorker.controller, undefined, {
		timeout: 15_000
	});
}

async function waitForCachedHtml(page: import('@playwright/test').Page, path: string) {
	// SWR populates HTML_CACHE in the background after the first network
	// fetch resolves. Poll caches.match() instead of guessing a delay.
	await page.waitForFunction(
		async (p) => {
			const hit = await caches.match(p);
			return !!hit && hit.ok;
		},
		path,
		{ timeout: 15_000 }
	);
}

test('service worker serves the warmed welcome page when offline', async ({ context, page }) => {
	await page.goto('/');
	await waitForSwActive(page);
	// First reload: page now becomes controlled by the SW (we don't call
	// clients.claim outside SKIP_WAITING). Second pass triggers a SWR cycle
	// that populates HTML_CACHE for `/`.
	await page.reload();
	await waitForController(page);
	await waitForCachedHtml(page, '/');

	await context.setOffline(true);
	await page.reload();

	// Welcome hero rendered from cache, not a network-error page.
	await expect(page.locator('main ul.features li')).toHaveCount(4);
	await context.setOffline(false);
});

test('service worker falls back to /offline for uncached routes when offline', async ({
	context,
	page
}) => {
	await page.goto('/');
	await waitForSwActive(page);
	await page.reload();
	await waitForController(page);
	// /offline is added to SHELL_CACHE during install. Confirm before going
	// offline so we know the fallback exists.
	await page.waitForFunction(
		async () => {
			const hit = await caches.match('/offline');
			return !!hit;
		},
		undefined,
		{ timeout: 15_000 }
	);

	await context.setOffline(true);
	// Use a route the SW has never seen — not in WARM_ROUTES, not previously
	// fetched, and not under /auth or /api (those are bypassed by the SW
	// and would fail with a network error rather than the offline fallback).
	const resp = await page.goto('/this-route-was-never-cached');
	expect(resp).not.toBeNull();
	// SW returns the cached /offline body; the URL bar still shows the
	// requested path.
	await expect(page.locator('h1').first()).toBeVisible();
	await expect(page.getByText(/offline/i).first()).toBeVisible();
	await context.setOffline(false);
});

test('PURGE_USER_CACHES message wipes HTML + IMG caches but preserves SHELL', async ({ page }) => {
	await page.goto('/');
	await waitForSwActive(page);
	await page.reload();
	await waitForController(page);
	await waitForCachedHtml(page, '/');

	// Plant a synthetic entry in the image cache so we can prove it gets
	// wiped. The SW only opens IMG_CACHE on the first image fetch, and
	// the welcome page ships no images — so derive the canonical cache
	// name from the SHELL cache key (which IS open) and pre-create it.
	await page.evaluate(async () => {
		const keys = await caches.keys();
		const shell = keys.find((k) => k.startsWith('duosync-shell-v'));
		if (!shell) throw new Error('expected the shell cache to exist');
		const version = shell.replace('duosync-shell-v', '');
		const cache = await caches.open(`duosync-img-v${version}`);
		await cache.put(
			new Request('/__test__/probe.png'),
			new Response('x', { status: 200, headers: { 'content-type': 'image/png' } })
		);
	});

	// Send the purge message and wait for the SW's MessagePort reply.
	const purged = await page.evaluate(
		() =>
			new Promise<boolean>((resolve) => {
				const ctrl = navigator.serviceWorker.controller;
				if (!ctrl) return resolve(false);
				const channel = new MessageChannel();
				channel.port1.onmessage = (e) => resolve(!!(e.data as { ok?: boolean })?.ok);
				setTimeout(() => resolve(false), 5000);
				ctrl.postMessage('PURGE_USER_CACHES', [channel.port2]);
			})
	);
	expect(purged).toBe(true);

	// HTML + IMG caches gone; SHELL cache (with /offline) untouched.
	const state = await page.evaluate(async () => {
		const keys = await caches.keys();
		return {
			hasHtml: keys.some((k) => k.startsWith('duosync-html-')),
			hasImg: keys.some((k) => k.startsWith('duosync-img-')),
			offlineStillCached: !!(await caches.match('/offline'))
		};
	});
	expect(state.hasHtml).toBe(false);
	expect(state.hasImg).toBe(false);
	expect(state.offlineStillCached).toBe(true);
});

// -----------------------------------------------------------------------
// Pre-paint redirect (the welcome-flash kill).
//
// The inline <script> in src/app.html runs synchronously in <head> before
// the body parses. It reads the `ds_auth` cookie (set client-readable by
// hooks.server.ts; values: 'pulse', 'onboarding', '1' legacy, or absent)
// and `location.replace()`s signed-in users away from `/` and `/welcome`.
//
// The behavioural cookie-routing matrix is fully covered by the unit
// test in src/lib/client/route-stub.spec.ts (it extracts the inline
// script from app.html and runs every cookie scenario). The two e2e
// tests below cover what unit tests can't: that the script is actually
// embedded in the production HTML and survives the SW cache pipeline.
// -----------------------------------------------------------------------

test('anonymous visitor (no ds_auth cookie) still gets the welcome hero', async ({
	context,
	page
}) => {
	// Make sure no leaked cookie from a parallel test runs the redirect.
	await context.clearCookies();

	await page.goto('/welcome');
	// Welcome page renders normally — the inline script's early-return
	// path for absent/unknown cookie values keeps anonymous users put.
	await expect(page.locator('main ul.features li')).toHaveCount(4);
	expect(new URL(page.url()).pathname).toBe('/welcome');
});

test('cached `/` HTML embeds the inline pre-paint script (offline cold-launch guard)', async ({
	page
}) => {
	// The whole point of inlining the script is that the cached HTML
	// served by the SW offline already contains the redirect. Verify by
	// (a) warming the cache, (b) reading the cached Response body, and
	// (c) asserting the inline script + ds_auth cookie read are present.
	//
	// Note: `/` is a stub route — the server 303s it to /welcome for
	// anonymous users. The SW caches the redirect target (/welcome).
	await page.goto('/');
	await waitForSwActive(page);
	await page.reload();
	await waitForController(page);
	await waitForCachedHtml(page, '/welcome');

	const cachedBody = await page.evaluate(async () => {
		const hit = (await caches.match('/welcome')) ?? (await caches.match('/'));
		return hit ? await hit.text() : null;
	});
	expect(cachedBody).not.toBeNull();
	// The inline IIFE reads document.cookie for ds_auth and calls
	// location.replace — both must be present in the body that the SW
	// will hand back on a cold offline launch.
	expect(cachedBody!).toMatch(/ds_auth=/);
	expect(cachedBody!).toMatch(/location\.replace/);
	// Must NOT reference the legacy external file.
	expect(cachedBody!).not.toMatch(/route-stub\.js/);
});
