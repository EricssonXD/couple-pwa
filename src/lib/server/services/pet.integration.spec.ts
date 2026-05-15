// DuoSync — pet earn pipeline integration spec.
//
// Hits a REAL Postgres (DATABASE_URL). Per pet-system.md §10 P2.4:
// idempotency, halving, dedupe ceiling, atomic concurrency, and
// write-path-only regression. Pure-surface coverage lives in
// pet.spec.ts.
//
// Cleanup policy: tests create a couple + 2 fake auth.users with
// random UUIDs and DELETE them in afterAll. Earn rows / wallet /
// pet rows cascade off `couple` (ON DELETE CASCADE). Pre-prod DB,
// orphans tolerated if a run aborts.
//
// Skipped automatically when DATABASE_URL is unset.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { db } from '$lib/server/db';
import { authUsers, couple, pet, petLedger, petWallet } from '$lib/server/db/schema';
import { awardForEvent, reconcileWallet } from '$lib/server/services/pet';
import { EARN_TABLE, computePay } from '$lib/pet.constants';

vi.mock('$lib/server/realtime', () => ({
	broadcastToCouple: vi.fn(async () => undefined)
}));

const HAVE_DB = !!process.env.DATABASE_URL;
const d = HAVE_DB ? describe : describe.skip;

// Each top-level describe owns its own couple + users so parallel test
// files don't trample each other's wallets.
function freshContext() {
	return {
		coupleId: randomUUID(),
		userA: randomUUID(),
		userB: randomUUID(),
		runTag: randomUUID().slice(0, 8)
	};
}

async function seed(ctx: ReturnType<typeof freshContext>) {
	// auth.users only requires `id`; the rest default to null/false.
	await db.insert(authUsers).values([{ id: ctx.userA }, { id: ctx.userB }]);
	// `partner_a < partner_b` check constraint — ensure we satisfy it.
	const [a, b] = ctx.userA < ctx.userB ? [ctx.userA, ctx.userB] : [ctx.userB, ctx.userA];
	await db.insert(couple).values({
		id: ctx.coupleId,
		partnerA: a,
		partnerB: b,
		status: 'active'
	});
}

async function teardown(ctx: ReturnType<typeof freshContext>) {
	// Cascade does most of the work; auth.users we delete explicitly.
	await db.delete(couple).where(eq(couple.id, ctx.coupleId));
	await db.delete(authUsers).where(eq(authUsers.id, ctx.userA));
	await db.delete(authUsers).where(eq(authUsers.id, ctx.userB));
}

d('awardForEvent — idempotency + halving', () => {
	const ctx = freshContext();
	beforeAll(() => seed(ctx));
	afterAll(() => teardown(ctx));

	it('same dedupeKey twice → 1 ledger row, wallet credited once', async () => {
		const key = `daily_send:${ctx.userA}:2099-01-01-${ctx.runTag}`;
		const r1 = await awardForEvent({
			coupleId: ctx.coupleId,
			userId: ctx.userA,
			source: 'daily_send',
			dedupeKey: key,
			mutual: false
		});
		const r2 = await awardForEvent({
			coupleId: ctx.coupleId,
			userId: ctx.userA,
			source: 'daily_send',
			dedupeKey: key,
			mutual: false
		});
		expect(r1.granted).toBe(true);
		expect(r1.deduped).toBe(false);
		expect(r2.granted).toBe(false);
		expect(r2.deduped).toBe(true);

		const rows = await db
			.select({ id: petLedger.id })
			.from(petLedger)
			.where(and(eq(petLedger.coupleId, ctx.coupleId), eq(petLedger.dedupeKey, key)));
		expect(rows).toHaveLength(1);
	});

	it('mutual=false halves coinsFull/xpFull (Math.floor)', async () => {
		// daily_reveal is mutualOnly=true so passing mutual=false → AWARD_FAILED.
		// Use a non-mutualOnly source for the halving check instead.
		const expected = computePay('daily_reveal', false);
		expect(expected.coinsDelta).toBe(4);
		expect(expected.xpDelta).toBe(2);

		const soloKey = `daily_send:halving-${ctx.runTag}`;
		const res = await awardForEvent({
			coupleId: ctx.coupleId,
			userId: ctx.userA,
			source: 'daily_send',
			dedupeKey: soloKey,
			mutual: false
		});
		expect(res.granted).toBe(true);
		expect(res.coinsDelta).toBe(computePay('daily_send', false).coinsDelta); // 1
		expect(res.xpDelta).toBe(computePay('daily_send', false).xpDelta); // 0
	});

	it('mutual=true pays full table values', async () => {
		const key = `daily_reveal:fullpay-${ctx.runTag}`;
		const res = await awardForEvent({
			coupleId: ctx.coupleId,
			userId: ctx.userA,
			source: 'daily_reveal',
			dedupeKey: key,
			mutual: true
		});
		expect(res.granted).toBe(true);
		expect(res.coinsDelta).toBe(EARN_TABLE.daily_reveal.coinsFull); // 8
		expect(res.xpDelta).toBe(EARN_TABLE.daily_reveal.xpFull); // 4
	});
});

d('awardForEvent — dedupe ceiling (mood_log per UTC hour)', () => {
	const ctx = freshContext();
	beforeAll(() => seed(ctx));
	afterAll(() => teardown(ctx));

	it('4 calls with same hour bucket key → 1 ledger row', async () => {
		const key = `mood_log:${ctx.userA}:2099-06-15T14`;
		const results = await Promise.all(
			Array.from({ length: 4 }, () =>
				awardForEvent({
					coupleId: ctx.coupleId,
					userId: ctx.userA,
					source: 'mood_log',
					dedupeKey: key,
					mutual: false
				})
			)
		);
		const granted = results.filter((r) => r.granted).length;
		const deduped = results.filter((r) => r.deduped).length;
		expect(granted).toBe(1);
		expect(deduped).toBe(3);

		const rows = await db
			.select({ id: petLedger.id })
			.from(petLedger)
			.where(and(eq(petLedger.coupleId, ctx.coupleId), eq(petLedger.dedupeKey, key)));
		expect(rows).toHaveLength(1);
	});
});

d('awardForEvent — atomic concurrency (B4)', () => {
	const ctx = freshContext();
	beforeAll(() => seed(ctx));
	afterAll(() => teardown(ctx));

	it('10 concurrent calls with distinct dedupeKeys → wallet sum exact', async () => {
		const keys = Array.from({ length: 10 }, (_, i) => `daily_send:concur-${ctx.runTag}-${i}`);
		const results = await Promise.all(
			keys.map((key) =>
				awardForEvent({
					coupleId: ctx.coupleId,
					userId: ctx.userA,
					source: 'daily_send',
					dedupeKey: key,
					mutual: true // full pay so we have a non-zero xp to sum too
				})
			)
		);
		const grantedCount = results.filter((r) => r.granted).length;
		expect(grantedCount).toBe(10);

		const expectedCoins = results.reduce((s, r) => s + r.coinsDelta, 0);
		const expectedXp = results.reduce((s, r) => s + r.xpDelta, 0);

		const [wallet] = await db
			.select({ coins: petWallet.coins, lifetimeEarned: petWallet.lifetimeEarned })
			.from(petWallet)
			.where(eq(petWallet.coupleId, ctx.coupleId));
		expect(wallet.coins).toBe(expectedCoins);
		expect(wallet.lifetimeEarned).toBe(expectedCoins);

		const ledgerRows = await db
			.select({ id: petLedger.id, xpDelta: petLedger.xpDelta })
			.from(petLedger)
			.where(eq(petLedger.coupleId, ctx.coupleId));
		expect(ledgerRows).toHaveLength(10);
		expect(ledgerRows.reduce((s, r) => s + r.xpDelta, 0)).toBe(expectedXp);
	}, 30_000);
});

d('awardForEvent — programmer-error guard', () => {
	const ctx = freshContext();
	beforeAll(() => seed(ctx));
	afterAll(() => teardown(ctx));

	it('mutualOnly source with mutual=false → AWARD_FAILED, no ledger row', async () => {
		const key = `daily_reveal:guard-${ctx.runTag}`;
		const res = await awardForEvent({
			coupleId: ctx.coupleId,
			userId: ctx.userA,
			source: 'daily_reveal',
			dedupeKey: key,
			mutual: false
		});
		expect(res.failed).toBe(true);
		expect(res.granted).toBe(false);

		const rows = await db
			.select({ id: petLedger.id })
			.from(petLedger)
			.where(and(eq(petLedger.coupleId, ctx.coupleId), eq(petLedger.dedupeKey, key)));
		expect(rows).toHaveLength(0);
	});
});

d('awardForEvent — pet bumping is best-effort when no pet exists', () => {
	const ctx = freshContext();
	beforeAll(() => seed(ctx));
	afterAll(() => teardown(ctx));

	it('couple has no pet row → wallet still credited, no error', async () => {
		// Confirm no pet exists for this couple.
		const before = await db.select({ id: pet.id }).from(pet).where(eq(pet.coupleId, ctx.coupleId));
		expect(before).toHaveLength(0);

		// Use a source whose mutual full pay is non-zero (mood_log mutual=true → 1/1)
		// so we can verify the wallet was credited.
		const res = await awardForEvent({
			coupleId: ctx.coupleId,
			userId: ctx.userA,
			source: 'daily_send',
			dedupeKey: `daily_send:nopet-${ctx.runTag}`,
			mutual: true
		});
		expect(res.granted).toBe(true);
		expect(res.coinsDelta).toBeGreaterThan(0);

		const [wallet] = await db
			.select({ coins: petWallet.coins })
			.from(petWallet)
			.where(eq(petWallet.coupleId, ctx.coupleId));
		expect(wallet.coins).toBeGreaterThan(0);
	});
});

d('reconcileWallet — diagnostics audit (P5.3)', () => {
	const ctx = freshContext();
	beforeAll(() => seed(ctx));
	afterAll(() => teardown(ctx));

	it('no-op when wallet matches ledger sum (idempotent)', async () => {
		// Award once so wallet has a real, ledger-backed balance.
		await awardForEvent({
			coupleId: ctx.coupleId,
			userId: ctx.userA,
			source: 'daily_send',
			dedupeKey: `recon-noop-${ctx.runTag}`,
			mutual: true
		});

		const [before] = await db
			.select({ coins: petWallet.coins, version: petWallet.version })
			.from(petWallet)
			.where(eq(petWallet.coupleId, ctx.coupleId));

		const r1 = await reconcileWallet(ctx.coupleId);
		expect(r1.adjusted).toBe(0);

		const [after] = await db
			.select({ coins: petWallet.coins, version: petWallet.version })
			.from(petWallet)
			.where(eq(petWallet.coupleId, ctx.coupleId));
		expect(after.coins).toBe(before.coins);
		// Idempotent: no version bump and no adjust ledger row written.
		expect(after.version).toBe(before.version);

		const adjustRows = await db
			.select({ id: petLedger.id })
			.from(petLedger)
			.where(and(eq(petLedger.coupleId, ctx.coupleId), eq(petLedger.kind, 'adjust')));
		expect(adjustRows.length).toBe(0);
	});

	it('corrects positive drift (wallet too high) and writes audit row', async () => {
		// Force drift by inflating wallet directly (simulates a write that
		// landed in pet_wallet but failed mid-flight before the ledger row).
		await db
			.update(petWallet)
			.set({ coins: 999, version: 50 })
			.where(eq(petWallet.coupleId, ctx.coupleId));

		const [sumRow] = await db
			.select({ total: petLedger.coinsDelta })
			.from(petLedger)
			.where(eq(petLedger.coupleId, ctx.coupleId))
			.limit(1);
		// Sanity: sum exists and is < 999.
		expect(sumRow).toBeDefined();

		const res = await reconcileWallet(ctx.coupleId);
		expect(res.adjusted).toBeLessThan(0); // wallet was too high

		const [after] = await db
			.select({ coins: petWallet.coins, version: petWallet.version })
			.from(petWallet)
			.where(eq(petWallet.coupleId, ctx.coupleId));
		expect(after.coins).toBeLessThan(999);
		expect(after.version).toBe(51);

		const adjustRows = await db
			.select({ source: petLedger.source, coinsDelta: petLedger.coinsDelta })
			.from(petLedger)
			.where(and(eq(petLedger.coupleId, ctx.coupleId), eq(petLedger.kind, 'adjust')));
		expect(adjustRows.length).toBe(1);
		expect(adjustRows[0].source).toMatch(/^reconcile:-?\d+$/);
		expect(adjustRows[0].coinsDelta).toBe(0);
	});

	it('corrects negative drift (wallet too low)', async () => {
		// Drop wallet below ledger sum — reconcile should bump it back up.
		const [before] = await db
			.select({ coins: petWallet.coins })
			.from(petWallet)
			.where(eq(petWallet.coupleId, ctx.coupleId));

		await db.update(petWallet).set({ coins: 0 }).where(eq(petWallet.coupleId, ctx.coupleId));

		const res = await reconcileWallet(ctx.coupleId);
		expect(res.adjusted).toBeGreaterThan(0); // wallet was too low → positive correction

		const [after] = await db
			.select({ coins: petWallet.coins })
			.from(petWallet)
			.where(eq(petWallet.coupleId, ctx.coupleId));
		expect(after.coins).toBe(before.coins);
	});
});
