import { expect, test } from '@playwright/test';

// These tests exercise the unauthenticated dev surface against the local
// preview build. Authenticated flows live in playwright.prod.config.ts +
// prod-smoke.test.ts. Service workers are blocked on every context to
// avoid net::ERR_ABORTED races on cross-page navigation (see
// playwright.prod.config.ts and global-setup.ts for the same pattern).
test.use({ serviceWorkers: 'block' });

test('welcome page renders the hero', async ({ page }) => {
	await page.goto('/welcome');
	await expect(page.locator('h1').first()).toBeVisible();

	// Welcome hero advertises 4 product pillars.
	await expect(page.locator('main ul.features li')).toHaveCount(4);

	// Primary CTA links to /auth/sign-in (only when online — preview is online).
	await expect(page.locator('a[href="/auth/sign-in"]')).toBeVisible();
});

test('anonymous visit to / redirects to /welcome', async ({ page }) => {
	await page.goto('/');
	await expect(page).toHaveURL(/\/welcome$/);
	// And once on /welcome, the hero must render — not a blank router stub.
	await expect(page.locator('main ul.features li')).toHaveCount(4);
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
// The pre-paint redirect script is shipped as a static file (so the
// page template can be safely prerendered with strict CSP). When the SW
// serves the cached `/` HTML and the device has a `ds_auth` hint cookie,
// the script must `location.replace()` to the right destination before
// the body paints. The live preview server doesn't reach that code path
// online (its server load 303s anonymous traffic to /welcome), so we
// simulate the cached scenario by route-intercepting `/` with a minimal
// HTML body that embeds the same redirect script. This way the test
// actually exercises the script we ship instead of duplicating it.
async function readInlineRedirectScript(): Promise<string> {
	const fs = await import('node:fs/promises');
	const path = await import('node:path');
	const html = await fs.readFile(path.resolve('src/app.html'), 'utf8');
	const match = html.match(/<script>([\s\S]*?\bds_auth\b[\s\S]*?)<\/script>/);
	if (!match) throw new Error('pre-paint redirect script not found in src/app.html');
	return match[1];
}

for (const [cookieValue, expectedPath, label] of [
	['pulse', '/pulse', 'pulse'],
	['onboarding', '/onboarding', 'onboarding'],
	['1', '/pulse', 'legacy "1"'],
	['', '/welcome', 'no cookie → welcome']
] as const) {
	test(`pre-paint script (${label}) redirects from / to ${expectedPath}`, async ({
		context,
		page
	}) => {
		const script = await readInlineRedirectScript();
		if (cookieValue) {
			await context.addInitScript((value: string) => {
				document.cookie = `ds_auth=${value}; path=/`;
			}, cookieValue);
		}
		// Intercept ONLY the `/` document request so child requests
		// (favicon, fonts, etc.) still hit the preview server normally.
		await context.route('**/', (route, req) => {
			if (req.resourceType() !== 'document') return route.continue();
			return route.fulfill({
				status: 200,
				contentType: 'text/html',
				body: `<!doctype html><html><head><script>${script}</script></head><body></body></html>`
			});
		});
		const requested: string[] = [];
		page.on('request', (req) => {
			if (req.resourceType() === 'document') requested.push(new URL(req.url()).pathname);
		});
		await page.goto('/', { waitUntil: 'networkidle' });
		const path = new URL(page.url()).pathname;
		expect(path).not.toBe('/');
		expect(requested).toContain(expectedPath);
		// The features list must not have rendered on the synthetic stub
		// (it has no body content). For the /welcome target it WILL render
		// after the redirect — only assert it's absent for app destinations.
		if (expectedPath !== '/welcome') {
			await expect(page.locator('main ul.features li')).toHaveCount(0);
		}
	});
}
