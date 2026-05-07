import { expect, test } from '@playwright/test';

test('home page renders an h1', async ({ page }) => {
	await page.goto('/');
	await expect(page.locator('h1').first()).toBeVisible();
});

test('unauthenticated visit to /pulse redirects to sign-in', async ({ page }) => {
	const resp = await page.goto('/pulse');
	// Either we land on /auth/sign-in directly or the welcome flow.
	expect(resp?.ok()).toBeTruthy();
	await expect(page).toHaveURL(/\/(auth\/sign-in|welcome|onboarding)/);
});
