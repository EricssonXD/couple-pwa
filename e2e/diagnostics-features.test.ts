/**
 * Diagnostics-features smoke + interactive e2e — runs against the deployed
 * Cloudflare Worker via `playwright.prod.config.ts`. Reuses the alice/bob
 * storage states captured by `e2e/global-setup.ts`.
 *
 * One test per feature linked from the /settings → Diagnostics card:
 *   1. /settings/offline-queue
 *   2. /bucket
 *   3. /calendar
 *   4. /chat
 *   5. /notes  (time capsules)
 *   6. /settings/activity
 *
 * Each test:
 *   - Records console errors + any 5xx network responses for the route.
 *   - Asserts the primary heading renders (catches the recent
 *     "Failed to fetch dynamically imported module" 500s).
 *   - For features with a CRUD primitive, creates a uniquely-marked entity,
 *     asserts it surfaces in the list, then deletes it via the UI to keep
 *     prod state clean.
 *
 * Fixtures must already exist (alice + bob, paired, email-confirmed). See
 * scripts/seed-test-couple.ts.
 */
import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import path from 'node:path';

const ALICE_STATE = path.resolve('e2e/.auth/alice.json');

/**
 * Attach console + network error collectors that ignore noise we know is
 * benign in dev (Vite optimize-dep 504s never appear in prod, but the
 * collector is defensive). Returns getters so each test can assert at the
 * end.
 */
function collectErrors(page: Page) {
	const consoleErrors: string[] = [];
	const httpErrors: string[] = [];

	page.on('console', (msg: ConsoleMessage) => {
		if (msg.type() !== 'error') return;
		const text = msg.text();
		// Filter noise that isn't a real defect:
		// - SW client-side preload races during navigation
		// - paraglide stale dynamic imports from a previous deploy
		if (/Failed to fetch dynamically imported module/i.test(text)) {
			httpErrors.push(`console: ${text}`);
			return;
		}
		consoleErrors.push(text);
	});

	page.on('response', async (resp) => {
		const status = resp.status();
		if (status >= 500) {
			httpErrors.push(`${status} ${resp.request().method()} ${resp.url()}`);
		}
	});

	return {
		consoleErrors: () => consoleErrors,
		httpErrors: () => httpErrors
	};
}

test.describe('Diagnostics features (Alice, prod)', () => {
	test.use({ storageState: ALICE_STATE });

	test('1. /settings/offline-queue renders + retry control responds', async ({ page }) => {
		const errors = collectErrors(page);
		await page.goto('/settings/offline-queue');
		await expect(page.getByRole('heading', { level: 1, name: 'Offline queue' })).toBeVisible();
		// "Retry now" button must be present (disabled when queue is empty
		// is fine; we only assert it's wired).
		await expect(page.getByRole('button', { name: /Retry now|Retrying/ })).toBeVisible();
		expect(errors.consoleErrors(), 'console errors').toEqual([]);
		expect(errors.httpErrors(), '5xx / dynamic-import failures').toEqual([]);
	});

	test('2. /bucket renders + add+remove round-trip works', async ({ page }) => {
		const errors = collectErrors(page);
		await page.goto('/bucket');
		// Composer textbox is the title input.
		const titleInput = page.getByPlaceholder('Watch the sunrise from a hot-air balloon');
		await expect(titleInput).toBeVisible();

		const marker = `e2e-bucket-${Date.now()}`;
		await titleInput.fill(marker);
		await page.getByRole('button', { name: 'Add', exact: true }).click();

		const item = page.getByText(marker, { exact: true }).first();
		await expect(item).toBeVisible({ timeout: 10_000 });

		// Cleanup — find the Remove button in the same row.
		const row = page.locator('li', { hasText: marker }).first();
		await row.getByRole('button', { name: 'Remove' }).click();
		await expect(item).toHaveCount(0, { timeout: 10_000 });

		expect(errors.consoleErrors()).toEqual([]);
		expect(errors.httpErrors()).toEqual([]);
	});

	test('3. /calendar renders + add+remove event round-trip works', async ({ page }) => {
		const errors = collectErrors(page);
		await page.goto('/calendar');
		const titleInput = page.getByPlaceholder('Date night at the noodle place');
		await expect(titleInput).toBeVisible();

		const marker = `e2e-cal-${Date.now()}`;
		const startsAt = new Date(Date.now() + 6 * 60 * 60 * 1000); // 6h from now
		const local = new Date(startsAt.getTime() - startsAt.getTimezoneOffset() * 60_000)
			.toISOString()
			.slice(0, 16);

		await titleInput.fill(marker);
		await page.locator('input[type="datetime-local"]').first().fill(local);
		await page.getByRole('button', { name: 'Add event' }).click();

		const ev = page.getByText(marker, { exact: true }).first();
		await expect(ev).toBeVisible({ timeout: 10_000 });

		const row = page.locator('li', { hasText: marker }).first();
		await row.getByRole('button', { name: 'Remove' }).click();
		await expect(ev).toHaveCount(0, { timeout: 10_000 });

		expect(errors.consoleErrors()).toEqual([]);
		expect(errors.httpErrors()).toEqual([]);
	});

	test('4. /chat renders + send echoes back into the list', async ({ page }) => {
		const errors = collectErrors(page);
		await page.goto('/chat');
		await expect(page.getByRole('heading', { level: 1, name: 'Chat' })).toBeVisible();

		const composer = page.getByPlaceholder('Type a message…');
		await expect(composer).toBeVisible();

		const marker = `e2e-chat-${Date.now()}`;
		await composer.fill(marker);
		await page.getByRole('button', { name: 'Send' }).click();

		await expect(page.getByText(marker, { exact: true }).first()).toBeVisible({
			timeout: 10_000
		});
		// 7-day TTL purges this automatically; no cleanup needed.

		expect(errors.consoleErrors()).toEqual([]);
		expect(errors.httpErrors()).toEqual([]);
	});

	test('5. /notes renders + schedule+cancel round-trip works', async ({ page }) => {
		const errors = collectErrors(page);
		await page.goto('/notes');
		await expect(
			page.getByRole('heading', { level: 1, name: 'Send a time capsule' })
		).toBeVisible();

		const body = page.getByPlaceholder("Write something they'll love opening later…");
		await expect(body).toBeVisible();

		const marker = `e2e-note-${Date.now()}`;
		// Server requires deliver_at >= 5 min from now; pick 30 min ahead.
		const deliverAt = new Date(Date.now() + 30 * 60_000);
		const local = new Date(deliverAt.getTime() - deliverAt.getTimezoneOffset() * 60_000)
			.toISOString()
			.slice(0, 16);

		await body.fill(marker);
		await page.locator('input[type="datetime-local"]').first().fill(local);
		await page.getByRole('button', { name: /^Schedule$|^Scheduling/ }).click();

		const note = page.getByText(marker, { exact: true }).first();
		await expect(note).toBeVisible({ timeout: 10_000 });

		// Cleanup — cancel via the per-row Cancel button. The page also
		// shows a window.confirm; auto-accept it.
		page.once('dialog', (d) => d.accept());
		const row = page.locator('li', { hasText: marker }).first();
		await row.getByRole('button', { name: 'Cancel' }).click();
		await expect(note).toHaveCount(0, { timeout: 10_000 });

		expect(errors.consoleErrors()).toEqual([]);
		expect(errors.httpErrors()).toEqual([]);
	});

	test('6. /settings/activity renders + audit log loads', async ({ page }) => {
		const errors = collectErrors(page);
		await page.goto('/settings/activity');
		await expect(page.getByRole('heading', { level: 1, name: 'Activity log' })).toBeVisible();
		// Either entries are rendered, or the empty-state copy is shown.
		// We don't depend on which — both are valid healthy outcomes.
		const empty = page.getByText('Nothing yet — start a moment, send a daily, leave a note.');
		const list = page.locator('ol, ul').first();
		await expect(empty.or(list)).toBeVisible({ timeout: 10_000 });

		expect(errors.consoleErrors()).toEqual([]);
		expect(errors.httpErrors()).toEqual([]);
	});
});
