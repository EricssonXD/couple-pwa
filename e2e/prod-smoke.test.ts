/**
 * Production smoke test — drives Alice + Bob in parallel browser contexts
 * against the live Cloudflare Worker.
 *
 * Each test gets fresh, independently-authed contexts loaded from storage
 * state captured by `global-setup.ts`. Tests are NOT order-dependent.
 *
 * Pre-req: run `ALLOW_TEST_SEED=1 bun run scripts/seed-test-couple.ts` so
 * alice@duosync.test + bob@duosync.test are paired and email-confirmed.
 *
 * Test 2 wipes today's daily_question_answer rows for the couple before
 * the daily-question scenario so the reveal flow is reproducible.
 *
 * Usage:
 *   DATABASE_URL=... bunx playwright test -c playwright.prod.config.ts
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import postgres from 'postgres';
import path from 'node:path';

const ALICE = { email: 'alice@duosync.test', name: 'Alice' };
const BOB = { email: 'bob@duosync.test', name: 'Bob' };

const ALICE_STATE = path.resolve('e2e/.auth/alice.json');
const BOB_STATE = path.resolve('e2e/.auth/bob.json');

async function clearTodaysDailyAnswers() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL must be set so the test can reset daily-answer state.');
	const sql = postgres(url, { prepare: false });
	try {
		await sql`
			DELETE FROM daily_question_answer
			WHERE created_at >= date_trunc('day', now() at time zone 'utc')
			  AND user_id IN (
			    SELECT id FROM auth.users WHERE email IN (${ALICE.email}, ${BOB.email})
			  )
		`;
	} finally {
		await sql.end();
	}
}

/** Build a (alice, bob) pair of fresh contexts loaded from saved auth state. */
async function pair(browser: import('@playwright/test').Browser): Promise<{
	aliceCtx: BrowserContext;
	bobCtx: BrowserContext;
	alice: Page;
	bob: Page;
}> {
	const aliceCtx = await browser.newContext({ storageState: ALICE_STATE });
	const bobCtx = await browser.newContext({ storageState: BOB_STATE });
	return {
		aliceCtx,
		bobCtx,
		alice: await aliceCtx.newPage(),
		bob: await bobCtx.newPage()
	};
}

test.describe('production smoke — Alice + Bob', () => {
	test('1. /pulse renders with the partner visible to each side', async ({ browser }) => {
		const { aliceCtx, bobCtx, alice, bob } = await pair(browser);
		try {
			await Promise.all([alice.goto('/pulse'), bob.goto('/pulse')]);

			await expect(alice).toHaveURL(/\/pulse$/);
			await expect(bob).toHaveURL(/\/pulse$/);

			// /pulse no longer has an h1; partner name is rendered under the
			// PartnerAvatar card. Both sides should see the other's name.
			await expect(alice.getByText(BOB.name).first()).toBeVisible();
			await expect(bob.getByText(ALICE.name).first()).toBeVisible();

			// Bottom nav (only renders when authed + paired) — 4 tabs: Pulse / Map / Moments / You.
			// Labels are i18n'd; match by stable href via locator.
			for (const p of [alice, bob]) {
				await expect(p.locator('nav a[href="/pulse"]')).toBeVisible();
				await expect(p.locator('nav a[href="/map"]')).toBeVisible();
				await expect(p.locator('nav a[href="/moments"]')).toBeVisible();
				await expect(p.locator('nav a[href="/settings"]')).toBeVisible();
			}
		} finally {
			await aliceCtx.close();
			await bobCtx.close();
		}
	});

	test('2. daily question reveal-after-both', async ({ browser }) => {
		await clearTodaysDailyAnswers();
		const { aliceCtx, bobCtx, alice, bob } = await pair(browser);
		try {
			await Promise.all([alice.goto('/daily'), bob.goto('/daily')]);

			const aliceAnswer = `alice-test-${Date.now()}`;
			const bobAnswer = `bob-test-${Date.now()}`;

			// Same prompt on both sides (deterministic per UTC date + couple).
			// The prompt sits inside <main>; grab the first paragraph for the comparison.
			const promptA = await alice.locator('main p').first().innerText();
			const promptB = await bob.locator('main p').first().innerText();
			expect(promptA).toBe(promptB);
			expect(promptA.length).toBeGreaterThan(0);

			// Alice answers first.
			await alice.getByPlaceholder(/Take your time/).fill(aliceAnswer);
			await alice.getByRole('button', { name: /Send your answer/ }).click();

			// After her own POST, Alice sees her own answer card AND a "Waiting" card.
			await expect(alice.getByText(aliceAnswer)).toBeVisible();
			await expect(alice.getByText(/Waiting for Bob to answer/i)).toBeVisible();

			// Bob (refreshing his page) should NOT yet see Alice's answer (RLS hides until both answered).
			await bob.reload();
			await expect(bob.getByText(aliceAnswer)).toHaveCount(0);
			await expect(bob.getByPlaceholder(/Take your time/)).toBeVisible();

			// Bob answers.
			await bob.getByPlaceholder(/Take your time/).fill(bobAnswer);
			await bob.getByRole('button', { name: /Send your answer/ }).click();

			// Bob sees both answers immediately after his POST (server invalidates).
			await expect(bob.getByText(bobAnswer)).toBeVisible();
			await expect(bob.getByText(aliceAnswer)).toBeVisible();

			// Alice reloads — she now sees Bob's answer too.
			await alice.reload();
			await expect(alice.getByText(aliceAnswer)).toBeVisible();
			await expect(alice.getByText(bobAnswer)).toBeVisible();
		} finally {
			await aliceCtx.close();
			await bobCtx.close();
		}
	});

	test('3. /moments and /settings render without error', async ({ browser }) => {
		const { aliceCtx, bobCtx, alice, bob } = await pair(browser);
		try {
			for (const p of [alice, bob]) {
				await p.goto('/moments');
				// /moments h1 is "Moments" (intentionally English in the redesign).
				await expect(p.getByRole('heading', { name: 'Moments' })).toBeVisible();

				await p.goto('/settings');
				// /settings h1 is "設定" post-redesign.
				await expect(p.getByRole('heading', { name: '設定' })).toBeVisible();
				// Display name is bound by value (no `name` attr in the new form).
				// Reach it by its label.
				const nameInput = p.getByLabel(/暱稱|display name/i);
				if (await nameInput.count()) {
					await expect(nameInput.first()).not.toHaveValue('');
				}
			}
		} finally {
			await aliceCtx.close();
			await bobCtx.close();
		}
	});

	test('4. sign-out clears the session', async ({ browser }) => {
		const ctx = await browser.newContext({ storageState: ALICE_STATE });
		const page = await ctx.newPage();
		try {
			await page.goto('/settings');
			const signOut = page
				.getByRole('button', { name: /sign out|log out/i })
				.or(page.getByRole('link', { name: /sign out|log out/i }));
			if (await signOut.count()) {
				await signOut.first().click();
			} else {
				await page.request.post('/auth/sign-out');
				await page.goto('/pulse');
			}
			await expect(page).toHaveURL(/\/auth\/sign-in/);
		} finally {
			await ctx.close();
		}
	});
});
