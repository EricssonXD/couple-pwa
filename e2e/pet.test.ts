/**
 * Pet system smoke + interactive e2e — runs against the deployed
 * Cloudflare Worker via `playwright.prod.config.ts`. Reuses the
 * alice/bob storage states captured by `e2e/global-setup.ts`.
 *
 * The fixture couple is shared with diagnostics-features.test.ts
 * (alice@duosync.test ↔ bob@duosync.test) and is assumed to already
 * have a hatched pet — re-running this spec must be idempotent against
 * any prior pet state on the fixture.
 *
 * Coverage:
 *   1. /pet renders without console / 5xx errors and shows the pet name + stage.
 *   2. The "Recent activity" ledger strip renders (P5.2).
 *   3. The /settings/diagnostics/pet-ledger page loads, shows the table,
 *      and the "Reconcile wallet" button is present + responds without
 *      surfacing an error notice (idempotent — diff=0 on a healthy wallet).
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import path from 'node:path';

const ALICE_STATE = path.resolve('e2e/.auth/alice.json');

function collectErrors(page: Page) {
	const consoleErrors: string[] = [];
	const httpErrors: string[] = [];

	page.on('console', (msg: ConsoleMessage) => {
		if (msg.type() !== 'error') return;
		const text = msg.text();
		if (/Failed to fetch dynamically imported module/i.test(text)) {
			httpErrors.push(`console: ${text}`);
			return;
		}
		consoleErrors.push(text);
	});

	page.on('response', (resp) => {
		if (resp.status() >= 500) httpErrors.push(`${resp.status()} ${resp.url()}`);
	});

	return {
		consoleErrors: () => consoleErrors,
		httpErrors: () => httpErrors
	};
}

test.describe('Pet system (Alice, prod)', () => {
	test.use({ storageState: ALICE_STATE });

	test('1. /pet renders pet header + activity strip', async ({ page }) => {
		const errors = collectErrors(page);
		await page.goto('/pet');

		// The header h1 carries the pet name. We don't know the name (it
		// was set during fixture seeding or a prior run), so just assert
		// an h1 exists and is non-empty.
		const heading = page.getByRole('heading', { level: 1 }).first();
		await expect(heading).toBeVisible({ timeout: 15_000 });
		const headingText = (await heading.textContent())?.trim() ?? '';
		expect(headingText.length).toBeGreaterThan(0);

		// Stage line under the header — one of Egg / Baby / Grown.
		await expect(page.getByText(/^(Egg|Baby|Grown|蛋|幼|成)/).first()).toBeVisible();

		// "Recent activity" strip header (P5.2). May be empty on a brand
		// new fixture, so we only assert the section heading renders.
		await expect(page.getByRole('heading', { name: /Recent activity|最近活動/ })).toBeVisible();

		expect(errors.consoleErrors(), 'console errors').toEqual([]);
		expect(errors.httpErrors(), '5xx / dynamic-import failures').toEqual([]);
	});

	test('2. /settings/diagnostics/pet-ledger renders + reconcile is idempotent', async ({
		page
	}) => {
		const errors = collectErrors(page);
		await page.goto('/settings/diagnostics/pet-ledger');

		await expect(
			page.getByRole('heading', { level: 1, name: /Pet ledger|寵物賬本/ })
		).toBeVisible();

		// Reconcile button is wired — click it and assert a status notice
		// surfaces (success or "all good"). On a healthy wallet the
		// service is a no-op, so we accept either the "all good" message
		// or the "reconciled by N" message. We MUST NOT see the error
		// state.
		const reconcileBtn = page.getByRole('button', { name: /Reconcile wallet|對帳/ });
		await expect(reconcileBtn).toBeVisible();
		await reconcileBtn.click();

		// One of: ok (no drift) | fixed (drift corrected). Never error.
		await expect(page.getByText(/All good|錢包同賬本一致|Reconciled|已修正/i).first()).toBeVisible({
			timeout: 15_000
		});
		await expect(page.getByText(/Couldn't reconcile|暫時對唔到帳/i)).toHaveCount(0);

		expect(errors.consoleErrors(), 'console errors').toEqual([]);
		expect(errors.httpErrors(), '5xx / dynamic-import failures').toEqual([]);
	});
});
