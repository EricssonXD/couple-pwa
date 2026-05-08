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
