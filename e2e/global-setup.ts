import { chromium, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const ACCOUNTS = [
	{ key: 'alice', email: 'alice@duosync.test', password: 'alice-test-pw-2025!' },
	{ key: 'bob', email: 'bob@duosync.test', password: 'bob-test-pw-2025!' }
];

export default async function globalSetup(config: FullConfig) {
	const baseURL =
		config.projects[0]?.use?.baseURL ??
		process.env.PROD_URL ??
		'https://couple-pwa.ericssonxd.workers.dev';

	const dir = path.resolve('e2e/.auth');
	mkdirSync(dir, { recursive: true });

	// Block the PWA service worker — its fetch handler races with Playwright's
	// navigation tracking and surfaces as net::ERR_ABORTED on cross-page goto.
	const browser = await chromium.launch();
	try {
		await Promise.all(
			ACCOUNTS.map(async (acct) => {
				const ctx = await browser.newContext({ baseURL, serviceWorkers: 'block' });
				const page = await ctx.newPage();
				await page.goto('/auth/sign-in');
				await page.getByLabel('Email').fill(acct.email);
				await page.getByLabel('Password').fill(acct.password);
				await Promise.all([
					page.waitForURL(/\/(pulse|onboarding)/, { timeout: 30_000 }),
					page.getByRole('button', { name: /^Sign in$/ }).click()
				]);
				// Wait for SSR to fully settle so the auth cookie chain is finalized.
				await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
				await ctx.storageState({ path: path.join(dir, `${acct.key}.json`) });
				await ctx.close();
			})
		);
	} finally {
		await browser.close();
	}
}
