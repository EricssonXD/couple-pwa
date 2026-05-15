import { expect, test } from '@playwright/test';

// F11 smoke. Without an authenticated session we can't exercise the
// camera/upload/finalize flow (it requires Supabase auth + a paired
// couple + browser MediaRecorder); the path is exercised manually +
// via the unit tests in src/lib/server/services/hourly.spec.ts and
// src/lib/hourly/recorder.spec.ts. What we can verify in the
// unauthenticated preview is that the route is wired correctly:
//
//   * /hourly redirects anonymous traffic to sign-in (auth gate)
//   * the API endpoints all return 401 unauthorized (no anon access)
//
// SW is blocked to avoid net::ERR_ABORTED races on cross-page nav,
// matching every other e2e file in this repo.
test.use({ serviceWorkers: 'block' });

test('unauthenticated /hourly redirects to sign-in', async ({ page }) => {
	const resp = await page.goto('/hourly');
	expect(resp?.ok()).toBeTruthy();
	await expect(page).toHaveURL(/\/(auth\/sign-in|welcome|onboarding)/);
});

const ENDPOINTS = [
	{ method: 'GET' as const, path: '/api/hourly/day?date=2025-01-01' },
	{ method: 'POST' as const, path: '/api/hourly/upload-attempt', body: { mime: 'video/webm' } },
	{ method: 'POST' as const, path: '/api/hourly/finalize', body: { attemptId: 'x' } },
	{ method: 'POST' as const, path: '/api/hourly/mood', body: { mood: 'happy' } },
	{ method: 'GET' as const, path: '/api/hourly/push-window' },
	{
		method: 'PUT' as const,
		path: '/api/hourly/push-window',
		body: { startHour: 9, endHour: 22, tz: 'UTC' }
	}
];

for (const ep of ENDPOINTS) {
	test(`unauthenticated ${ep.method} ${ep.path} → 401`, async ({ request }) => {
		const init: Parameters<typeof request.fetch>[1] = { method: ep.method };
		if ('body' in ep) {
			init.headers = { 'content-type': 'application/json' };
			init.data = JSON.stringify(ep.body);
		}
		const r = await request.fetch(ep.path, init);
		expect(r.status()).toBe(401);
	});
}

test('cron purge endpoint refuses unauthenticated POST', async ({ request }) => {
	const r = await request.fetch('/api/cron/hourly-purge', { method: 'POST' });
	// Either 401 (secret configured + missing header) or 503 (secret
	// not configured in preview env). Both prove no anon access leaks.
	expect([401, 503]).toContain(r.status());
});
