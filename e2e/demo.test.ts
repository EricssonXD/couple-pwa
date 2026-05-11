import { expect, test } from '@playwright/test';

// These tests exercise the unauthenticated dev surface against the local
// preview build. Authenticated flows live in playwright.prod.config.ts +
// prod-smoke.test.ts. Service workers are blocked on every context to
// avoid net::ERR_ABORTED races on cross-page navigation (see
// playwright.prod.config.ts and global-setup.ts for the same pattern).
test.use({ serviceWorkers: 'block' });

test('home page renders the welcome hero', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('h1').first()).toBeVisible();

	// Welcome hero advertises 4 product pillars.
	await expect(page.locator('main ul.features li')).toHaveCount(4);

	// Primary CTA links to /auth/sign-in (only when online — preview is online).
	await expect(page.locator('a[href="/auth/sign-in"]')).toBeVisible();
});

test('unauthenticated visit to /pulse redirects to sign-in', async ({ page }) => {
	const resp = await page.goto('/pulse');
	expect(resp?.ok()).toBeTruthy();
	await expect(page).toHaveURL(/\/(auth\/sign-in|welcome|onboarding)/);
});

test('sign-in page renders the email + password form', async ({ page }) => {
	await page.goto('/auth/sign-in');
	await expect(page.getByLabel('Email')).toBeVisible();
	await expect(page.getByLabel('Password')).toBeVisible();
	await expect(page.getByRole('button', { name: /^Sign in$/ })).toBeVisible();
});

test('offline page renders standalone', async ({ page }) => {
	const resp = await page.goto('/offline');
	expect(resp?.ok()).toBeTruthy();
	// Offline page must always have an h1 (it's also the SW fallback).
	await expect(page.locator('h1').first()).toBeVisible();
});

// Pre-paint redirect: when the device has the `ds_auth` hint cookie,
// landing on `/` must NOT show the welcome hero — the inline script in
// app.html aborts the navigation before paint and re-routes to the
// destination encoded in the cookie.
// (We can't reach a real authed /pulse without a live Supabase session,
// so the assertion is "URL no longer points at /" — proving the script
// fired and routed to the right destination.)
for (const [cookieValue, expectedPath, label] of [
	['pulse', '/pulse', 'pulse'],
	['onboarding', '/onboarding', 'onboarding'],
	['1', '/pulse', 'legacy "1"']
] as const) {
	test(`signed-in hint cookie (${label}) pre-paint redirects away from welcome`, async ({
		context,
		page
	}) => {
		// Set the hint via init script so it's available to the inline pre-paint
		// script before any server Set-Cookie can clear it. Mirrors the offline
		// PWA scenario where the SW serves cached HTML and the cookie from a
		// prior session is still on the device.
		await context.addInitScript((value: string) => {
			document.cookie = `ds_auth=${value}; path=/`;
		}, cookieValue);
		// Track every document request so we can assert the inline script
		// routed to the correct destination — even if a server redirect
		// chain follows (e.g. /pulse → /auth/sign-in when no real session).
		const requested: string[] = [];
		page.on('request', (req) => {
			if (req.resourceType() === 'document') requested.push(new URL(req.url()).pathname);
		});
		await page.goto('/', { waitUntil: 'networkidle' });
		const path = new URL(page.url()).pathname;
		expect(path).not.toBe('/');
		expect(requested).toContain(expectedPath);
		// Welcome features list must never have rendered.
		await expect(page.locator('main ul.features li')).toHaveCount(0);
	});
}
