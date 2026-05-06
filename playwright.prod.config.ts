import { defineConfig, devices } from '@playwright/test';

/**
 * Production smoke-test config — runs against the deployed Cloudflare Worker.
 * No local web server. Requires the `alice@duosync.test` / `bob@duosync.test`
 * fixture accounts to exist in the target Supabase project (re-run
 * `ALLOW_TEST_SEED=1 bun run scripts/seed-test-couple.ts` if not).
 *
 * Usage:  bunx playwright test -c playwright.prod.config.ts
 */
export default defineConfig({
	testDir: 'e2e',
	testMatch: /prod-smoke\.test\.ts/,
	globalSetup: './e2e/global-setup.ts',
	timeout: 60_000,
	expect: { timeout: 15_000 },
	reporter: [['list']],
	use: {
		baseURL: process.env.PROD_URL ?? 'https://couple-pwa.ericssonxd.workers.dev',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		// Block the PWA service worker — its fetch handler races with Playwright's
		// navigation tracking and surfaces as net::ERR_ABORTED on cross-page goto.
		serviceWorkers: 'block'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }]
});
