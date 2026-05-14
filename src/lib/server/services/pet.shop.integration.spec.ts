// DuoSync — pet shop service integration spec (Phase 4 P4.5).
//
// Hits a REAL Postgres (DATABASE_URL). Mirrors the contract from
// pet-system.md §10 P4.5: insufficient coins → 402, slot collision
// auto-unequip, treat qty→0 leaves row, stage-locked → 403, two
// concurrent buyItems → exactly one wins (the second sees 402, NOT
// 409 — see rubber-duck note in pet.ts: user-facing answer is
// "did you have the coins?" after retries exhaust).
//
// Skipped automatically when DATABASE_URL is unset.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { db } from '$lib/server/db';
import { authUsers, couple, pet, petInventory, petLedger, petWallet } from '$lib/server/db/schema';
import {
	PetShopError,
	buyItem,
	consumeTreat,
	equipCosmetic,
	hatchPet,
	listShopItems
} from '$lib/server/services/pet';
import { TREAT_EFFECTS } from '$lib/pet.constants';

vi.mock('$lib/server/realtime', () => ({
	broadcastToCouple: vi.fn(async () => undefined)
}));

const HAVE_DB = !!process.env.DATABASE_URL;
const d = HAVE_DB ? describe : describe.skip;

// Most tests stack 5+ DB round-trips; remote postgres latency makes the
// 5s default flaky. The earn-pipeline integration spec runs ~20s; we
// budget similar headroom here.
const TEST_TIMEOUT = 30_000;

function freshContext() {
	return {
		coupleId: randomUUID(),
		userA: randomUUID(),
		userB: randomUUID(),
		runTag: randomUUID().slice(0, 8)
	};
}

async function seed(ctx: ReturnType<typeof freshContext>) {
	await db.insert(authUsers).values([{ id: ctx.userA }, { id: ctx.userB }]);
	const [a, b] = ctx.userA < ctx.userB ? [ctx.userA, ctx.userB] : [ctx.userB, ctx.userA];
	await db.insert(couple).values({
		id: ctx.coupleId,
		partnerA: a,
		partnerB: b,
		status: 'active'
	});
}

async function teardown(ctx: ReturnType<typeof freshContext>) {
	await db.delete(couple).where(eq(couple.id, ctx.coupleId));
	await db.delete(authUsers).where(eq(authUsers.id, ctx.userA));
	await db.delete(authUsers).where(eq(authUsers.id, ctx.userB));
}

/** Force the wallet to a known coin balance after `ensureWallet`. */
async function setCoins(coupleId: string, coins: number): Promise<void> {
	await db
		.update(petWallet)
		.set({ coins, version: 1, updatedAt: new Date() })
		.where(eq(petWallet.coupleId, coupleId));
}

/** Force the pet's xp + stage so we can test stage gating without grinding. */
async function setStage(coupleId: string, stage: 'egg' | 'baby' | 'grown'): Promise<void> {
	const xp = stage === 'grown' ? 250 : stage === 'baby' ? 50 : 0;
	await db.update(pet).set({ xp, stage }).where(eq(pet.coupleId, coupleId));
}

d('listShopItems — catalogue + ownership join', () => {
	const ctx = freshContext();
	beforeAll(() => seed(ctx));
	afterAll(() => teardown(ctx));

	it(
		'omits disabled items, marks unlocked by stage, includes ownership',
		async () => {
			await hatchPet(ctx.coupleId, 'fox', `Listy ${ctx.runTag}`);
			await setStage(ctx.coupleId, 'egg');

			const items = await listShopItems(ctx.coupleId);
			// Egg-stage couple sees no disabled buffs at all.
			expect(items.find((i) => i.id === 'buff_doublecoin')).toBeUndefined();
			// Sort order respected.
			const cake = items.find((i) => i.id === 'treat_cake')!;
			const strawberry = items.find((i) => i.id === 'treat_strawberry')!;
			expect(strawberry.sortOrder).toBeLessThan(cake.sortOrder);
			// Stage gating: cake.minStage='grown' is locked at egg, strawberry='egg' is unlocked.
			expect(strawberry.unlocked).toBe(true);
			expect(cake.unlocked).toBe(false);
			// Nothing owned yet.
			expect(strawberry.ownedQty).toBe(0);
			expect(strawberry.equipped).toBe(false);
		},
		TEST_TIMEOUT
	);
});

d('buyItem — coin spend, stacking, errors, concurrency', () => {
	const ctx = freshContext();
	beforeAll(() => seed(ctx));
	afterAll(() => teardown(ctx));

	it(
		'cosmetic purchase: deducts coins, creates inventory + spend ledger row',
		async () => {
			await hatchPet(ctx.coupleId, 'fox', `Buyer ${ctx.runTag}`);
			await setStage(ctx.coupleId, 'grown'); // unlock all cosmetics
			await setCoins(ctx.coupleId, 100);

			const { snapshot, inventory } = await buyItem(ctx.coupleId, ctx.userA, 'hat_paper_crown');
			expect(snapshot.wallet.coins).toBe(100 - 30);
			const inv = inventory.find((i) => i.itemId === 'hat_paper_crown');
			expect(inv).toBeDefined();
			expect(inv!.qty).toBe(1);
			expect(inv!.equipped).toBe(false);

			const ledger = await db
				.select()
				.from(petLedger)
				.where(
					and(eq(petLedger.coupleId, ctx.coupleId), eq(petLedger.source, 'shop:hat_paper_crown'))
				);
			expect(ledger).toHaveLength(1);
			expect(ledger[0]!.kind).toBe('spend');
			expect(ledger[0]!.coinsDelta).toBe(-30);
		},
		TEST_TIMEOUT
	);

	it(
		'rejects re-buy of an already-owned cosmetic',
		async () => {
			await setCoins(ctx.coupleId, 500);
			await expect(buyItem(ctx.coupleId, ctx.userA, 'hat_paper_crown')).rejects.toMatchObject({
				code: 'item_already_owned'
			});
		},
		TEST_TIMEOUT
	);

	it(
		'treat purchases stack qty++',
		async () => {
			await setCoins(ctx.coupleId, 100);
			await buyItem(ctx.coupleId, ctx.userA, 'treat_strawberry');
			const result = await buyItem(ctx.coupleId, ctx.userA, 'treat_strawberry');
			const inv = result.inventory.find((i) => i.itemId === 'treat_strawberry');
			expect(inv!.qty).toBe(2);
		},
		TEST_TIMEOUT
	);

	it(
		'insufficient coins → throws PetShopError(insufficient_coins)',
		async () => {
			await setCoins(ctx.coupleId, 5);
			await expect(buyItem(ctx.coupleId, ctx.userA, 'scarf_red')).rejects.toMatchObject({
				code: 'insufficient_coins'
			});
			// Wallet untouched.
			const [w] = await db.select().from(petWallet).where(eq(petWallet.coupleId, ctx.coupleId));
			expect(w!.coins).toBe(5);
		},
		TEST_TIMEOUT
	);

	it(
		'stage-locked item → throws PetShopError(item_locked)',
		async () => {
			await setCoins(ctx.coupleId, 1000);
			await setStage(ctx.coupleId, 'egg');
			// scarf_dotted requires 'grown'.
			await expect(buyItem(ctx.coupleId, ctx.userA, 'scarf_dotted')).rejects.toMatchObject({
				code: 'item_locked'
			});
		},
		TEST_TIMEOUT
	);

	it(
		'disabled buff → throws PetShopError(item_disabled)',
		async () => {
			await setCoins(ctx.coupleId, 1000);
			await expect(buyItem(ctx.coupleId, ctx.userA, 'buff_doublecoin')).rejects.toMatchObject({
				code: 'item_disabled'
			});
		},
		TEST_TIMEOUT
	);
});

d('buyItem — concurrent purchases serialise via wallet version', () => {
	const ctx = freshContext();
	beforeAll(() => seed(ctx));
	afterAll(() => teardown(ctx));

	it(
		'two parallel buys with budget for one → exactly one succeeds, other 402',
		async () => {
			await hatchPet(ctx.coupleId, 'cat', `Race ${ctx.runTag}`);
			await setStage(ctx.coupleId, 'grown');
			// scarf_red costs 50; budget = 50. Only one can win.
			// Use *different* items so item_already_owned doesn't gate the
			// second attempt before the wallet check.
			await setCoins(ctx.coupleId, 50);

			const results = await Promise.allSettled([
				buyItem(ctx.coupleId, ctx.userA, 'scarf_red'),
				buyItem(ctx.coupleId, ctx.userA, 'hat_beanie')
			]);
			const fulfilled = results.filter((r) => r.status === 'fulfilled');
			const rejected = results.filter((r) => r.status === 'rejected');
			expect(fulfilled).toHaveLength(1);
			expect(rejected).toHaveLength(1);
			expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(PetShopError);
			expect((rejected[0] as PromiseRejectedResult).reason.code).toBe('insufficient_coins');

			const [w] = await db.select().from(petWallet).where(eq(petWallet.coupleId, ctx.coupleId));
			expect(w!.coins).toBe(0);
		},
		TEST_TIMEOUT
	);
});

d('equipCosmetic — slot collision auto-unequip', () => {
	const ctx = freshContext();
	beforeAll(() => seed(ctx));
	afterAll(() => teardown(ctx));

	it(
		'equipping a second hat unequips the first',
		async () => {
			await hatchPet(ctx.coupleId, 'bird', `Equipper ${ctx.runTag}`);
			await setStage(ctx.coupleId, 'grown');
			await setCoins(ctx.coupleId, 200);
			await buyItem(ctx.coupleId, ctx.userA, 'hat_paper_crown');
			await buyItem(ctx.coupleId, ctx.userA, 'hat_beanie');

			await equipCosmetic(ctx.coupleId, 'hat_paper_crown', true);
			let inv = await db.select().from(petInventory).where(eq(petInventory.coupleId, ctx.coupleId));
			expect(inv.find((r) => r.itemId === 'hat_paper_crown')!.equipped).toBe(true);

			// Equip the second hat — first must auto-unequip.
			await equipCosmetic(ctx.coupleId, 'hat_beanie', true);
			inv = await db.select().from(petInventory).where(eq(petInventory.coupleId, ctx.coupleId));
			expect(inv.find((r) => r.itemId === 'hat_paper_crown')!.equipped).toBe(false);
			expect(inv.find((r) => r.itemId === 'hat_beanie')!.equipped).toBe(true);
		},
		TEST_TIMEOUT
	);

	it(
		'unequip is idempotent and clears slot',
		async () => {
			const result = await equipCosmetic(ctx.coupleId, 'hat_beanie', false);
			expect(result.inventory.find((i) => i.itemId === 'hat_beanie')!.equipped).toBe(false);
			// Calling again is a no-op.
			await expect(equipCosmetic(ctx.coupleId, 'hat_beanie', false)).resolves.toBeDefined();
		},
		TEST_TIMEOUT
	);

	it(
		'non-cosmetic → item_not_cosmetic',
		async () => {
			await setCoins(ctx.coupleId, 100);
			await buyItem(ctx.coupleId, ctx.userA, 'treat_strawberry');
			await expect(equipCosmetic(ctx.coupleId, 'treat_strawberry', true)).rejects.toMatchObject({
				code: 'item_not_cosmetic'
			});
		},
		TEST_TIMEOUT
	);

	it(
		'uninventoried item → inventory_empty',
		async () => {
			await expect(equipCosmetic(ctx.coupleId, 'expr_sleepy', true)).rejects.toMatchObject({
				code: 'inventory_empty'
			});
		},
		TEST_TIMEOUT
	);
});

d('consumeTreat — mood/hunger update, qty decrement, stage gating', () => {
	const ctx = freshContext();
	beforeAll(() => seed(ctx));
	afterAll(() => teardown(ctx));

	it(
		'reduces hunger, lifts mood, decrements qty (row stays at 0)',
		async () => {
			await hatchPet(ctx.coupleId, 'capybara', `Eater ${ctx.runTag}`);
			await setStage(ctx.coupleId, 'grown');
			await setCoins(ctx.coupleId, 100);
			await buyItem(ctx.coupleId, ctx.userA, 'treat_strawberry');

			// Pin mood/hunger timestamps to a *future* moment so projectDecay
			// is a no-op when consumeTreat reads (now < stored.updatedAt →
			// clamped to 0 days). This isolates the test from postgres tx
			// timing variance.
			const future = new Date(Date.now() + 60_000);
			await db
				.update(pet)
				.set({
					mood: 50,
					hunger: 40,
					moodUpdatedAt: future,
					hungerUpdatedAt: future
				})
				.where(eq(pet.coupleId, ctx.coupleId));

			const effect = TREAT_EFFECTS.treat_strawberry!;
			const { snapshot, inventory } = await consumeTreat(
				ctx.coupleId,
				ctx.userA,
				'treat_strawberry'
			);
			expect(snapshot.pet!.mood).toBe(50 + effect.mood);
			expect(snapshot.pet!.hunger).toBe(40 - effect.hunger);

			// qty went 1 → 0 but row persists.
			const inv = inventory.find((i) => i.itemId === 'treat_strawberry');
			expect(inv).toBeDefined();
			expect(inv!.qty).toBe(0);

			const ledger = await db
				.select()
				.from(petLedger)
				.where(
					and(eq(petLedger.coupleId, ctx.coupleId), eq(petLedger.source, 'treat:treat_strawberry'))
				);
			expect(ledger).toHaveLength(1);
			expect(ledger[0]!.coinsDelta).toBe(0);
		},
		TEST_TIMEOUT
	);

	it(
		'out-of-stock → inventory_empty',
		async () => {
			await expect(consumeTreat(ctx.coupleId, ctx.userA, 'treat_strawberry')).rejects.toMatchObject(
				{ code: 'inventory_empty' }
			);
		},
		TEST_TIMEOUT
	);

	it(
		'non-treat item → item_not_treat',
		async () => {
			await setStage(ctx.coupleId, 'grown');
			await setCoins(ctx.coupleId, 100);
			await buyItem(ctx.coupleId, ctx.userA, 'hat_paper_crown');
			await expect(consumeTreat(ctx.coupleId, ctx.userA, 'hat_paper_crown')).rejects.toMatchObject({
				code: 'item_not_treat'
			});
		},
		TEST_TIMEOUT
	);

	it(
		'stage-locked treat refuses on egg pet',
		async () => {
			await setCoins(ctx.coupleId, 100);
			await setStage(ctx.coupleId, 'egg');
			// treat_cake is grown-stage. Buy is allowed at the seed level only
			// when stage matches; verify the consume guard separately by
			// inserting inventory directly so we isolate the consume gate.
			await db.insert(petInventory).values({
				coupleId: ctx.coupleId,
				itemId: 'treat_cake',
				slot: null,
				qty: 1,
				equipped: false
			});
			await expect(consumeTreat(ctx.coupleId, ctx.userA, 'treat_cake')).rejects.toMatchObject({
				code: 'item_locked'
			});
		},
		TEST_TIMEOUT
	);
});

d('consumeTreat — pet_not_found when no pet hatched', () => {
	const ctx = freshContext();
	beforeAll(() => seed(ctx));
	afterAll(() => teardown(ctx));

	it(
		'throws pet_not_found before touching inventory',
		async () => {
			await expect(consumeTreat(ctx.coupleId, ctx.userA, 'treat_strawberry')).rejects.toMatchObject(
				{ code: 'pet_not_found' }
			);
		},
		TEST_TIMEOUT
	);
});
