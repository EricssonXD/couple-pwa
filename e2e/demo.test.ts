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
