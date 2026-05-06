/**
 * Production smoke test — drives Alice + Bob in parallel browser contexts
 * against the live Cloudflare Worker.
 *
 * Covers:
 *  - sign-in for both fixture accounts
 *  - /pulse renders with the partner's name visible to each side
 *  - /daily question round-trip: Alice answers → Bob still sees waiting card
 *    → Bob answers → both sides see the partner's reply (RLS reveal-after-both)
 *  - /moments + /settings render without server error
 *  - sign-out clears the session
 *
 * Pre-req: run `ALLOW_TEST_SEED=1 bun run scripts/seed-test-couple.ts` so
 * alice@duosync.test + bob@duosync.test are paired and email-confirmed.
 *
 * The test wipes today's daily_question_answer rows for the couple before the
 * daily-question scenario so the reveal flow is reproducible.
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import postgres from 'postgres';

const ALICE = { email: 'alice@duosync.test', password: 'alice-test-pw-2025!', name: 'Alice' };
const BOB = { email: 'bob@duosync.test', password: 'bob-test-pw-2025!', name: 'Bob' };

async function signIn(page: Page, who: { email: string; password: string }) {
	await page.goto('/auth/sign-in');
	await page.getByLabel('Email').fill(who.email);
	await page.getByLabel('Password').fill(who.password);
	await Promise.all([
		page.waitForURL(/\/(pulse|onboarding)/, { timeout: 30_000 }),
		page.getByRole('button', { name: /^Sign in$/ }).click()
	]);
}

async function clearTodaysDailyAnswers() {
	const url = process.env.DATABASE_URL;
	if (!url) throw new Error('DATABASE_URL must be set so the test can reset daily-answer state.');
	const sql = postgres(url, { prepare: false });
	try {
		await sql`
			DELETE FROM daily_question_answer
			WHERE answered_for_date = CURRENT_DATE
			  AND user_id IN (
			    SELECT id FROM auth.users WHERE email IN ('alice@duosync.test', 'bob@duosync.test')
			  )
		`;
	} finally {
		await sql.end();
	}
}

test.describe('production smoke — Alice + Bob', () => {
	let aliceCtx: BrowserContext;
	let bobCtx: BrowserContext;
	let alice: Page;
	let bob: Page;

	test.beforeAll(async ({ browser }) => {
		aliceCtx = await browser.newContext();
		bobCtx = await browser.newContext();
		alice = await aliceCtx.newPage();
		bob = await bobCtx.newPage();
	});

	test.afterAll(async () => {
		await aliceCtx.close();
		await bobCtx.close();
	});

	test('1. both sign in and land on /pulse with partner visible', async () => {
		await Promise.all([signIn(alice, ALICE), signIn(bob, BOB)]);

		await expect(alice).toHaveURL(/\/pulse$/);
		await expect(bob).toHaveURL(/\/pulse$/);

		await expect(alice.getByRole('heading', { level: 1 })).toContainText(BOB.name);
		await expect(bob.getByRole('heading', { level: 1 })).toContainText(ALICE.name);

		// Bottom nav (only renders when authed + paired) — both should see all 4 tabs.
		for (const p of [alice, bob]) {
			await expect(p.getByRole('link', { name: /Pulse/ })).toBeVisible();
			await expect(p.getByRole('link', { name: /Moments/ })).toBeVisible();
			await expect(p.getByRole('link', { name: /Daily/ })).toBeVisible();
			await expect(p.getByRole('link', { name: /You/ })).toBeVisible();
		}
	});

	test('2. daily question reveal-after-both', async () => {
		await clearTodaysDailyAnswers();
		await Promise.all([alice.goto('/daily'), bob.goto('/daily')]);

		const aliceAnswer = `alice-test-${Date.now()}`;
		const bobAnswer = `bob-test-${Date.now()}`;

		// Same prompt on both sides (deterministic per UTC date + couple).
		const promptA = await alice.locator('section').first().innerText();
		const promptB = await bob.locator('section').first().innerText();
		expect(promptA).toBe(promptB);

		// Alice answers first.
		await alice.getByPlaceholder(/Take your time/).fill(aliceAnswer);
		await alice.getByRole('button', { name: /Send your answer/ }).click();

		// After her own POST, Alice sees her own answer card AND a "Waiting for Bob" card.
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
	});

	test('3. /moments and /settings render without error', async () => {
		for (const p of [alice, bob]) {
			await p.goto('/moments');
			await expect(p.getByRole('heading', { name: 'Moments' })).toBeVisible();

			await p.goto('/settings');
			await expect(p.getByRole('heading', { name: 'Settings' })).toBeVisible();
			// Profile field pre-filled with the seeded display name.
			const nameInput = p.locator('input[name="displayName"]');
			if (await nameInput.count()) {
				await expect(nameInput).not.toHaveValue('');
			}
		}
	});

	test('4. sign-out clears the session', async () => {
		// Find a sign-out form/button on /settings (POST form action).
		await alice.goto('/settings');
		const signOut = alice
			.getByRole('button', { name: /sign out|log out/i })
			.or(alice.getByRole('link', { name: /sign out|log out/i }));
		if (await signOut.count()) {
			await signOut.first().click();
		} else {
			// Fall back to hitting the documented endpoint directly.
			await alice.request.post('/auth/sign-out');
			await alice.goto('/pulse');
		}
		await expect(alice).toHaveURL(/\/auth\/sign-in/);
	});
});
