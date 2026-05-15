// DuoSync — shared virtual pet service.
//
// Phase 1: read state, hatch, rename, snapshot broadcast. Earn pipeline
// (`awardForEvent`), shop, treats, equip land in P2/P4. See
// pet-system.md for the full design.
//
// This service uses the service-role Drizzle client (bypasses RLS) so
// API handlers MUST derive coupleId from `loadCoupleAnyStatus(user.id)`,
// never from the request body. (B1 — pet routes intentionally accept
// inactive couples; the broadcast is what gates on status.)

import { and, desc, eq, gt, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	pet,
	petBuff,
	petInventory,
	petLedger,
	petShopItem,
	petWallet
} from '$lib/server/db/schema';
import { broadcastToCouple } from '$lib/server/realtime';
import { recordAudit } from '$lib/server/services/audit';
import {
	EARN_TABLE,
	NAME_MAX,
	NAME_MIN,
	SPECIES,
	TREAT_EFFECTS,
	BUFF_EFFECTS,
	BUFF_DURATION_MS,
	BUFF_MULTIPLIER_CAP,
	HUNGER_CEIL,
	HUNGER_FLOOR,
	MOOD_CEIL,
	MOOD_FLOOR,
	WELCOME_BACK_DEDUPE_DAYS,
	WELCOME_BACK_INACTIVE_DAYS,
	WELCOME_BACK_TREAT_ID,
	computePay,
	projectDecay,
	stageForXp,
	stageUnlocks,
	todayKey,
	type EarnSource,
	type EquippedItem,
	type PetInventoryEntry,
	type PetLedgerEntry,
	type PetMutationResult,
	type PetPublic,
	type PetSnapshot,
	type ShopItemKind,
	type ShopItemView,
	type Species,
	type Stage,
	type WalletPublic
} from '$lib/pet.constants';

export class PetValidationError extends Error {
	constructor(
		message: string,
		readonly code:
			| 'species_invalid'
			| 'name_empty'
			| 'name_too_long'
			| 'pet_already_exists'
			| 'pet_not_found'
	) {
		super(message);
		this.name = 'PetValidationError';
	}
}

// ─── Validation helpers ──────────────────────────────────────────────────

export function normalizeSpecies(raw: unknown): Species {
	if (typeof raw !== 'string' || !(SPECIES as readonly string[]).includes(raw)) {
		throw new PetValidationError('species invalid', 'species_invalid');
	}
	return raw as Species;
}

export function normalizeName(raw: unknown): string {
	if (typeof raw !== 'string') {
		throw new PetValidationError('name is required', 'name_empty');
	}
	// NFKC normalise + strip newlines, then trim. Width-collapsing keeps
	// the 24-char SQL CHECK aligned with what the user sees in the UI.
	const cleaned = raw
		.normalize('NFKC')
		.replace(/[\r\n]/g, '')
		.trim();
	if (cleaned.length < NAME_MIN) throw new PetValidationError('name is required', 'name_empty');
	if (cleaned.length > NAME_MAX) throw new PetValidationError('name too long', 'name_too_long');
	return cleaned;
}

// ─── Wire-shape mappers ──────────────────────────────────────────────────

function petRowToPublic(
	row: typeof pet.$inferSelect,
	projected: { mood: number; hunger: number }
): PetPublic {
	return {
		id: row.id,
		coupleId: row.coupleId,
		species: row.species as Species,
		name: row.name,
		stage: stageForXp(row.xp),
		xp: row.xp,
		mood: projected.mood,
		hunger: projected.hunger,
		moodUpdatedAt: row.moodUpdatedAt.toISOString(),
		hungerUpdatedAt: row.hungerUpdatedAt.toISOString(),
		version: row.version,
		hatchedAt: row.hatchedAt.toISOString()
	};
}

function walletRowToPublic(row: typeof petWallet.$inferSelect): WalletPublic {
	return {
		coupleId: row.coupleId,
		coins: row.coins,
		lifetimeEarned: row.lifetimeEarned,
		version: row.version,
		updatedAt: row.updatedAt.toISOString()
	};
}

// ─── Wallet provisioning ─────────────────────────────────────────────────
// Wallet row is created lazily on the first read so we don't have to
// race a "create wallet" step against pairing. ON CONFLICT DO NOTHING
// + re-read keeps us safe under concurrent first-reads.
async function ensureWallet(coupleId: string): Promise<WalletPublic> {
	const [existing] = await db
		.select()
		.from(petWallet)
		.where(eq(petWallet.coupleId, coupleId))
		.limit(1);
	if (existing) return walletRowToPublic(existing);
	await db.insert(petWallet).values({ coupleId }).onConflictDoNothing();
	const [reread] = await db
		.select()
		.from(petWallet)
		.where(eq(petWallet.coupleId, coupleId))
		.limit(1);
	if (!reread) throw new Error('wallet provisioning failed');
	return walletRowToPublic(reread);
}

async function readEquipped(coupleId: string): Promise<EquippedItem[]> {
	return db
		.select({ itemId: petInventory.itemId, slot: petInventory.slot })
		.from(petInventory)
		.where(and(eq(petInventory.coupleId, coupleId), eq(petInventory.equipped, true)));
}

// ─── Public API ──────────────────────────────────────────────────────────

/**
 * Pure read. Projects decay in-memory; never writes (D1, D2). The next
 * write path persists the projected values along with its own change.
 *
 * Welcome-back grant is a separate function (`maybeGrantWelcomeBack`)
 * called from the GET handler so this stays read-only and is safe to
 * call from anywhere (including the broadcast snapshot builder).
 */
export async function getPetState(
	coupleId: string,
	welcomeBack: PetSnapshot['welcomeBack'] = null,
	nowOverride?: Date
): Promise<PetSnapshot> {
	// `nowOverride` lets mutators (buyItem/equipCosmetic/consumeTreat)
	// reuse the same `now` they wrote with, so an immediate re-read
	// doesn't see a few-millisecond fractional decay that Math.floor
	// turns into a phantom -1 (e.g. mood 58 written, read back as 57).
	const now = nowOverride ?? new Date();
	const [petRow] = await db.select().from(pet).where(eq(pet.coupleId, coupleId)).limit(1);
	const [wallet, equipped] = await Promise.all([ensureWallet(coupleId), readEquipped(coupleId)]);

	let petPublic: PetPublic | null = null;
	if (petRow) {
		const decayed = projectDecay(
			{
				mood: petRow.mood,
				hunger: petRow.hunger,
				moodUpdatedAt: petRow.moodUpdatedAt,
				hungerUpdatedAt: petRow.hungerUpdatedAt
			},
			now
		);
		petPublic = petRowToPublic(petRow, decayed);
	}

	return {
		pet: petPublic,
		wallet,
		equipped,
		serverNow: now.toISOString(),
		welcomeBack
	};
}

/**
 * One-time hatch. Egg-stage with default mood/hunger; species is
 * immutable, name is renameable later. Errors:
 *   - species_invalid   — not in the 4 allowed species
 *   - name_empty        — missing/blank/whitespace-only
 *   - name_too_long     — > 24 chars after NFKC normalise
 *   - pet_already_exists — caught from the unique-on-coupleId index
 */
export async function hatchPet(
	coupleId: string,
	rawSpecies: unknown,
	rawName: unknown
): Promise<PetSnapshot> {
	const species = normalizeSpecies(rawSpecies);
	const name = normalizeName(rawName);
	try {
		await db.insert(pet).values({ coupleId, species, name });
	} catch (err) {
		if (
			err &&
			typeof err === 'object' &&
			'code' in err &&
			(err as { code: string }).code === '23505'
		) {
			throw new PetValidationError('pet already exists', 'pet_already_exists');
		}
		throw err;
	}
	await ensureWallet(coupleId);
	return getPetState(coupleId);
}

/** Rename an existing pet; bumps version for optimistic concurrency. */
export async function renamePet(coupleId: string, rawName: unknown): Promise<PetSnapshot> {
	const name = normalizeName(rawName);
	const result = await db
		.update(pet)
		.set({ name, version: sql`${pet.version} + 1` })
		.where(eq(pet.coupleId, coupleId))
		.returning({ id: pet.id });
	if (result.length === 0) throw new PetValidationError('pet not found', 'pet_not_found');
	return getPetState(coupleId);
}

/**
 * Welcome-back warm grant (W2). Idempotent per (userId, day) via
 * `welcome_back:<userId>:<YYYY-MM-DD>` dedupe key. The 90-day window
 * (b) is enforced by an explicit lookback so the grant cadence never
 * exceeds once-per-quarter even if the user hops in/out across years.
 *
 * Called from `GET /api/pet` only. Safe under concurrent calls — the
 * partial unique index `pet_ledger_dedupe_uq` is the tiebreaker; the
 * loser observes the inserted row and just returns null.
 */
export async function maybeGrantWelcomeBack(
	coupleId: string,
	userId: string
): Promise<PetSnapshot['welcomeBack']> {
	const now = Date.now();
	const inactivityCutoff = new Date(now - WELCOME_BACK_INACTIVE_DAYS * 86_400_000);
	const dedupeCutoff = new Date(now - WELCOME_BACK_DEDUPE_DAYS * 86_400_000);

	return db.transaction(async (tx) => {
		const [recentWelcome] = await tx
			.select({ id: petLedger.id })
			.from(petLedger)
			.where(
				and(
					eq(petLedger.coupleId, coupleId),
					eq(petLedger.userId, userId),
					eq(petLedger.source, 'welcome_back'),
					gt(petLedger.createdAt, dedupeCutoff)
				)
			)
			.limit(1);
		if (recentWelcome) return null;

		const [recentActivity] = await tx
			.select({ id: petLedger.id })
			.from(petLedger)
			.where(
				and(
					eq(petLedger.coupleId, coupleId),
					eq(petLedger.userId, userId),
					gt(petLedger.createdAt, inactivityCutoff)
				)
			)
			.limit(1);
		if (recentActivity) return null;

		const dedupeKey = `welcome_back:${userId}:${todayKey()}`;
		const [ledgerRow] = await tx
			.insert(petLedger)
			.values({
				coupleId,
				userId,
				kind: 'earn',
				source: 'welcome_back',
				coinsDelta: 0,
				xpDelta: 0,
				dedupeKey
			})
			.onConflictDoNothing({
				target: [petLedger.coupleId, petLedger.dedupeKey],
				where: sql`${petLedger.dedupeKey} is not null`
			})
			.returning({ id: petLedger.id });
		if (!ledgerRow) return null;

		// Grant treat: upsert qty++. `slot` stays null for treats.
		await tx
			.insert(petInventory)
			.values({ coupleId, itemId: WELCOME_BACK_TREAT_ID, qty: 1 })
			.onConflictDoUpdate({
				target: [petInventory.coupleId, petInventory.itemId],
				set: { qty: sql`${petInventory.qty} + 1` }
			});

		return { granted: true as const, treatId: WELCOME_BACK_TREAT_ID };
	});
}

/**
 * Build + emit a pet snapshot to the couple's private realtime channel.
 *
 * Skips silently when the couple is not active — broadcasts are no-ops
 * for paused/broken couples per the realtime RLS policy, and pet writes
 * still succeed. Failures are caught and logged so a flaky broadcast
 * never breaks a pet write (mirrors `awardForEvent` failure mode).
 */
export async function broadcastPetState(
	coupleId: string,
	coupleStatus: 'active' | 'paused' | 'broken' | string
): Promise<void> {
	if (coupleStatus !== 'active') return;
	try {
		const snap = await getPetState(coupleId);
		await broadcastToCouple(coupleId, { t: 'pet_state', ts: Date.now(), p: snap });
		// Telemetry (P6.6): structured log so logpush can aggregate per-couple
		// broadcast volume and verify the "≤ 21 messages/day/couple" budget
		// from pet-system.md §"Real-time sync" against live traffic.
		console.info('[telemetry] pet_state_broadcast', { coupleId });
	} catch (err) {
		console.warn('[pet] broadcastPetState failed', err);
	}
}

// ─── Earn pipeline (P2.1) ─────────────────────────────────────────────────
//
// Single funnel: every ritual that grants coins/XP calls `awardForEvent`
// with a dedupeKey shaped per the table in pet-system.md §3 "Wiring
// earn events". The unique partial index `pet_ledger_dedupe_uq`
// guarantees double-fire produces one ledger row; the wallet/pet
// updates run inside the SAME tx under an optimistic version check so
// either everything commits or nothing does (B4).
//
// Hard rules:
//   - MUST be awaited before the request returns (P1 — the AsyncLocalStorage
//     DB bundle is closed by ctx.waitUntil).
//   - Failure is non-fatal: any error short-circuits to `recordAudit(...)`
//     and returns `{ granted:false, deduped:false, failed:true, ... }`
//     so a flaky pet path can never break a relationship ritual.

export type AwardResult = {
	granted: boolean;
	deduped: boolean;
	failed: boolean;
	coinsDelta: number;
	xpDelta: number;
};

const AWARD_DEDUPED: AwardResult = {
	granted: false,
	deduped: true,
	failed: false,
	coinsDelta: 0,
	xpDelta: 0
};
const AWARD_FAILED: AwardResult = {
	granted: false,
	deduped: false,
	failed: true,
	coinsDelta: 0,
	xpDelta: 0
};
const MAX_AWARD_ATTEMPTS = 3;

class VersionConflictError extends Error {
	constructor(readonly target: 'wallet' | 'pet') {
		super(`version conflict on ${target}`);
		this.name = 'VersionConflictError';
	}
}

/**
 * Idempotently grant coins/XP for a ritual completion.
 *
 * `dedupeKey` shape is defined per source in pet-system.md §3
 * (e.g. `daily_reveal:<questionId>:<YYYY-MM-DD>`). Passing the same
 * key twice — even from concurrent isolates — is a guaranteed no-op
 * after the first win.
 *
 * `mutual = false` halves both deltas (Math.floor); `mutual = true`
 * pays the full table values. Sources with `EARN_TABLE[...].mutualOnly`
 * defensively assert `mutual === true`; passing `false` returns
 * AWARD_FAILED with an audit row (programmer error, not a runtime hazard).
 */
export async function awardForEvent(args: {
	coupleId: string;
	userId: string;
	source: EarnSource;
	dedupeKey: string;
	mutual: boolean;
}): Promise<AwardResult> {
	const { coupleId, userId, source, dedupeKey, mutual } = args;

	const row = EARN_TABLE[source];
	if (!row) {
		await recordAudit(userId, 'pet.award.failed', { coupleId, source, reason: 'unknown_source' });
		return AWARD_FAILED;
	}
	if (row.mutualOnly && !mutual) {
		await recordAudit(userId, 'pet.award.failed', {
			coupleId,
			source,
			dedupeKey,
			reason: 'mutual_required'
		});
		return AWARD_FAILED;
	}

	const base = computePay(source, mutual);

	// Apply any active multiplier buff for this couple. We multiply
	// 'coin' kind into coinsDelta and 'xp' kind into xpDelta. Capped
	// at ×BUFF_MULTIPLIER_CAP defensively (DB CHECK also enforces).
	// Lookup is a single-row indexed read; failure is silently treated
	// as no-buff (we never block an earn because the buff query fell
	// over). Multiplier is applied via Math.round so the ledger row
	// stays an integer — fractional cents would break wallet invariants.
	let coinsDelta = base.coinsDelta;
	let xpDelta = base.xpDelta;
	try {
		const buffs = await db
			.select({ kind: petBuff.kind, multiplier: petBuff.multiplier })
			.from(petBuff)
			.where(and(eq(petBuff.coupleId, coupleId), gt(petBuff.activeUntil, new Date())));
		for (const b of buffs) {
			const mul = Math.min(BUFF_MULTIPLIER_CAP, Number(b.multiplier));
			if (!Number.isFinite(mul) || mul <= 1) continue;
			if (b.kind === 'coin' && coinsDelta > 0) {
				coinsDelta = Math.round(coinsDelta * mul);
			} else if (b.kind === 'xp' && xpDelta > 0) {
				xpDelta = Math.round(xpDelta * mul);
			}
		}
	} catch (err) {
		console.warn('[pet] awardForEvent: buff lookup failed', err);
	}

	// Lazy-provision wallet OUTSIDE the retry loop so retries don't
	// race the INSERT … ON CONFLICT DO NOTHING repeatedly.
	try {
		await ensureWallet(coupleId);
	} catch (err) {
		console.warn('[pet] awardForEvent: ensureWallet failed', err);
		await recordAudit(userId, 'pet.award.failed', {
			coupleId,
			source,
			dedupeKey,
			reason: 'wallet_provision_failed'
		});
		return AWARD_FAILED;
	}

	for (let attempt = 0; attempt < MAX_AWARD_ATTEMPTS; attempt++) {
		try {
			const result = await db.transaction(async (tx) => {
				const [ledgerRow] = await tx
					.insert(petLedger)
					.values({
						coupleId,
						userId,
						kind: 'earn',
						source,
						coinsDelta,
						xpDelta,
						dedupeKey
					})
					.onConflictDoNothing({
						target: [petLedger.coupleId, petLedger.dedupeKey],
						where: sql`${petLedger.dedupeKey} is not null`
					})
					.returning({ id: petLedger.id });

				if (!ledgerRow) {
					return { kind: 'deduped' as const };
				}

				await bumpWalletAtomic(tx, coupleId, coinsDelta);
				await bumpPetAtomic(tx, coupleId, xpDelta);
				return { kind: 'applied' as const };
			});

			if (result.kind === 'deduped') return AWARD_DEDUPED;
			return {
				granted: true,
				deduped: false,
				failed: false,
				coinsDelta,
				xpDelta
			};
		} catch (err) {
			if (err instanceof VersionConflictError) {
				continue;
			}
			console.warn('[pet] awardForEvent: tx failed', { source, dedupeKey, err });
			await recordAudit(userId, 'pet.award.failed', {
				coupleId,
				source,
				dedupeKey,
				reason: 'tx_error',
				error: String(err)
			});
			return AWARD_FAILED;
		}
	}

	await recordAudit(userId, 'pet.award.failed', {
		coupleId,
		source,
		dedupeKey,
		reason: 'version_contention'
	});
	return AWARD_FAILED;
}

/**
 * Optimistic-version coin/lifetime bump inside an awardForEvent tx.
 * Read version → UPDATE WHERE version = read. Mismatch throws so the
 * outer transaction (including the ledger insert) rolls back and the
 * outer 3× loop retries cleanly.
 */
async function bumpWalletAtomic(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	coupleId: string,
	coinsDelta: number
): Promise<void> {
	const [existing] = await tx
		.select({ version: petWallet.version })
		.from(petWallet)
		.where(eq(petWallet.coupleId, coupleId))
		.limit(1);
	if (!existing) throw new VersionConflictError('wallet');

	const lifetimeAdd = coinsDelta > 0 ? coinsDelta : 0;
	const updated = await tx
		.update(petWallet)
		.set({
			coins: sql`${petWallet.coins} + ${coinsDelta}`,
			lifetimeEarned: sql`${petWallet.lifetimeEarned} + ${lifetimeAdd}`,
			version: existing.version + 1,
			updatedAt: new Date()
		})
		.where(and(eq(petWallet.coupleId, coupleId), eq(petWallet.version, existing.version)))
		.returning({ version: petWallet.version });
	if (updated.length === 0) throw new VersionConflictError('wallet');
}

/**
 * Optimistic-version XP bump for the pet, with mood/hunger
 * re-anchoring. Skipped silently when no pet exists yet (couple has
 * earned coins before hatching). Stage is recomputed from xp inline.
 */
async function bumpPetAtomic(
	tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
	coupleId: string,
	xpDelta: number
): Promise<void> {
	const [existing] = await tx.select().from(pet).where(eq(pet.coupleId, coupleId)).limit(1);
	if (!existing) return; // No pet yet — coins still credited above.

	const now = new Date();
	const projected = projectDecay(
		{
			mood: existing.mood,
			hunger: existing.hunger,
			moodUpdatedAt: existing.moodUpdatedAt,
			hungerUpdatedAt: existing.hungerUpdatedAt
		},
		now
	);
	const newXp = existing.xp + xpDelta;
	const newStage = stageForXp(newXp);

	const updated = await tx
		.update(pet)
		.set({
			xp: newXp,
			stage: newStage,
			mood: projected.mood,
			hunger: projected.hunger,
			moodUpdatedAt: now,
			hungerUpdatedAt: now,
			version: existing.version + 1
		})
		.where(and(eq(pet.coupleId, coupleId), eq(pet.version, existing.version)))
		.returning({ version: pet.version });
	if (updated.length === 0) throw new VersionConflictError('pet');
}

// ─── Phase 4 — Shop, inventory, treats, equip ─────────────────────────────
//
// Mutators (`buyItem`, `equipCosmetic`, `consumeTreat`) follow the same
// optimistic-version pattern as `awardForEvent`: a 3× retry loop wraps a
// single tx that reads version → writes WHERE version=read → throws
// `VersionConflictError` on mismatch. Spend ledger rows have
// `dedupeKey=null` (replays are user-initiated, not automatic).
//
// Service is pure: the route layer calls `broadcastPetState` after a
// successful mutation so service tests don't need the realtime mock to
// fire-and-forget. (B5 — broadcast is best-effort, never blocks the
// write path.)

export type PetShopErrorCode =
	| 'item_not_found'
	| 'item_locked'
	| 'item_disabled'
	| 'item_already_owned'
	| 'item_not_treat'
	| 'item_not_cosmetic'
	| 'item_not_buff'
	| 'inventory_empty'
	| 'insufficient_coins'
	| 'pet_not_found'
	| 'treat_effect_missing'
	| 'buff_effect_missing'
	| 'buff_xp_unavailable';

export class PetShopError extends Error {
	readonly code: PetShopErrorCode;
	constructor(code: PetShopErrorCode, message?: string) {
		super(message ?? code);
		this.name = 'PetShopError';
		this.code = code;
	}
}

/**
 * HTTP status mapping for PetShopError. Used by every shop endpoint
 * so the wire shape is consistent: 4xx for user-correctable failures,
 * 5xx only for invariant breaks (e.g. seed missing TREAT_EFFECTS).
 */
export function petShopErrorStatus(code: PetShopErrorCode): number {
	switch (code) {
		case 'item_not_found':
		case 'pet_not_found':
			return 404;
		case 'item_disabled':
		case 'item_locked':
			return 403;
		case 'insufficient_coins':
			return 402;
		case 'item_already_owned':
		case 'inventory_empty':
			return 409;
		case 'item_not_treat':
		case 'item_not_cosmetic':
		case 'item_not_buff':
			return 400;
		case 'buff_xp_unavailable':
			return 403;
		case 'treat_effect_missing':
		case 'buff_effect_missing':
			return 500;
	}
}

const SHOP_RETRY_LIMIT = 3;

// ─── Helpers ─────────────────────────────────────────────────────────────

function shopItemRowToPublic(row: typeof petShopItem.$inferSelect) {
	return {
		id: row.id,
		kind: row.kind as ShopItemKind,
		slot: row.slot,
		nameKey: row.nameKey,
		descriptionKey: row.descriptionKey,
		priceCoins: row.priceCoins,
		minStage: row.minStage as Stage,
		sortOrder: row.sortOrder
	};
}

function inventoryRowToPublic(
	row: Pick<typeof petInventory.$inferSelect, 'itemId' | 'qty' | 'equipped' | 'slot'>
): PetInventoryEntry {
	return {
		itemId: row.itemId,
		qty: row.qty,
		equipped: row.equipped,
		slot: row.slot
	};
}

async function readInventory(coupleId: string): Promise<PetInventoryEntry[]> {
	const rows = await db
		.select({
			itemId: petInventory.itemId,
			qty: petInventory.qty,
			equipped: petInventory.equipped,
			slot: petInventory.slot
		})
		.from(petInventory)
		.where(eq(petInventory.coupleId, coupleId));
	return rows.map(inventoryRowToPublic);
}

/** Public read of a couple's inventory — used by GET /api/pet/inventory. */
export async function getPetInventory(coupleId: string): Promise<PetInventoryEntry[]> {
	return readInventory(coupleId);
}

// ─── getPetLedger (P5.2) ─────────────────────────────────────────────────

/**
 * Read recent ledger rows for a couple, newest-first. The default
 * `limit=5` powers the /pet "Recent activity" strip; the diagnostics
 * page passes `limit=50` with `page>=1`.
 *
 * userId is intentionally never returned (W3 privacy: never reveal which
 * partner did what — see pet-system.md L943-963).
 *
 * Bounds: limit clamped to [1, 100], page clamped to [1, 1000]. The
 * page-cap is just a sanity guard — couples won't ever scroll that far
 * but we don't want a malicious offset request to OOM the worker.
 */
export async function getPetLedger(
	coupleId: string,
	options: { page?: number; limit?: number } = {}
): Promise<PetLedgerEntry[]> {
	const limit = Math.max(1, Math.min(100, options.limit ?? 5));
	const page = Math.max(1, Math.min(1000, options.page ?? 1));
	const offset = (page - 1) * limit;
	const rows = await db
		.select({
			id: petLedger.id,
			kind: petLedger.kind,
			source: petLedger.source,
			coinsDelta: petLedger.coinsDelta,
			xpDelta: petLedger.xpDelta,
			createdAt: petLedger.createdAt
		})
		.from(petLedger)
		.where(eq(petLedger.coupleId, coupleId))
		.orderBy(desc(petLedger.createdAt))
		.limit(limit)
		.offset(offset);
	return rows.map((r) => ({
		id: r.id,
		kind: r.kind as PetLedgerEntry['kind'],
		source: r.source,
		coinsDelta: r.coinsDelta,
		xpDelta: r.xpDelta,
		createdAt: r.createdAt.toISOString()
	}));
}

async function buildMutationResult(coupleId: string, now?: Date): Promise<PetMutationResult> {
	const [snapshot, inventory] = await Promise.all([
		getPetState(coupleId, null, now),
		readInventory(coupleId)
	]);
	return { snapshot, inventory };
}

// ─── reconcileWallet ─────────────────────────────────────────────────────

/**
 * Reconcile `pet_wallet.coins` against `SUM(pet_ledger.coins_delta)`.
 *
 * The ledger is the immutable journal (source of truth). The wallet is
 * a materialized running balance. If they drift (bug, partial write,
 * manual repair) the user can run reconcile from Settings →
 * Diagnostics. We trust the ledger sum, write a 0-delta `adjust` audit
 * row capturing the discrepancy in the source label, and update the
 * wallet balance to match.
 *
 * Idempotent: running with no drift writes nothing and bumps no
 * version.
 *
 * Returns `adjusted` = ledgerSum - walletCoins (signed delta applied
 * to the wallet). Zero means the wallet was already correct.
 */
export async function reconcileWallet(
	coupleId: string
): Promise<{ adjusted: number; result: PetMutationResult }> {
	await ensureWallet(coupleId);

	for (let attempt = 0; attempt < SHOP_RETRY_LIMIT; attempt += 1) {
		try {
			const adjusted = await db.transaction(async (tx) => {
				const [wallet] = await tx
					.select({ coins: petWallet.coins, version: petWallet.version })
					.from(petWallet)
					.where(eq(petWallet.coupleId, coupleId))
					.limit(1);
				if (!wallet) throw new VersionConflictError('wallet');

				const [sumRow] = await tx
					.select({ total: sql<string | null>`coalesce(sum(${petLedger.coinsDelta}), 0)` })
					.from(petLedger)
					.where(eq(petLedger.coupleId, coupleId));
				const ledgerSum = Number(sumRow?.total ?? 0);
				const diff = ledgerSum - wallet.coins;
				if (diff === 0) return 0;

				await tx.insert(petLedger).values({
					coupleId,
					userId: null,
					kind: 'adjust',
					source: `reconcile:${diff > 0 ? '+' : ''}${diff}`,
					coinsDelta: 0,
					xpDelta: 0
				});

				const updated = await tx
					.update(petWallet)
					.set({
						coins: ledgerSum,
						version: wallet.version + 1,
						updatedAt: new Date()
					})
					.where(and(eq(petWallet.coupleId, coupleId), eq(petWallet.version, wallet.version)))
					.returning({ version: petWallet.version });
				if (updated.length === 0) throw new VersionConflictError('wallet');

				return diff;
			});

			const result = await buildMutationResult(coupleId);
			return { adjusted, result };
		} catch (err) {
			if (err instanceof VersionConflictError && attempt < SHOP_RETRY_LIMIT - 1) continue;
			throw err;
		}
	}
	throw new VersionConflictError('wallet');
}

/** Current pet stage from xp, or null when no pet exists. */
async function readPetStage(coupleId: string): Promise<Stage | null> {
	const [row] = await db
		.select({ xp: pet.xp })
		.from(pet)
		.where(eq(pet.coupleId, coupleId))
		.limit(1);
	if (!row) return null;
	return stageForXp(row.xp);
}

// ─── listShopItems ───────────────────────────────────────────────────────

/**
 * Public catalogue + per-couple ownership state. Disabled items
 * (`enabled=false`, e.g. Phase 5 buffs) are filtered out — the route
 * never exposes them and `buyItem` rejects them too. Sorted by
 * `sort_order` so the UI renders cosmetics, treats, furniture in a
 * stable, designer-controlled order.
 */
export async function listShopItems(coupleId: string): Promise<ShopItemView[]> {
	const [items, inventory, stage] = await Promise.all([
		db
			.select()
			.from(petShopItem)
			.where(eq(petShopItem.enabled, true))
			.orderBy(petShopItem.sortOrder),
		readInventory(coupleId),
		readPetStage(coupleId)
	]);

	const ownedById = new Map<string, PetInventoryEntry>();
	for (const inv of inventory) ownedById.set(inv.itemId, inv);

	return items
		.filter((row) => {
			// v1 has no XP system — hide xp buffs from the shop entirely so
			// users can't buy something that can't be activated.
			if (row.kind === 'buff') {
				const effect = BUFF_EFFECTS[row.id];
				if (effect && effect.kind === 'xp') return false;
			}
			return true;
		})
		.map((row) => {
			const pub = shopItemRowToPublic(row);
			const owned = ownedById.get(pub.id);
			return {
				...pub,
				ownedQty: owned?.qty ?? 0,
				equipped: owned?.equipped ?? false,
				unlocked: stageUnlocks(stage, pub.minStage)
			};
		});
}

// ─── buyItem ─────────────────────────────────────────────────────────────

/**
 * Spend coins for a shop item.
 *
 * Errors → HTTP mapping in route:
 *   - item_not_found / item_disabled → 404
 *   - item_locked                    → 403  (pet stage < minStage)
 *   - item_already_owned             → 409  (cosmetic/furniture only)
 *   - insufficient_coins             → 402
 *
 * Concurrency: two parallel buys on the same wallet — one wins, the
 * other re-reads after retry. If the loser now over-spends, it returns
 * `insufficient_coins` (402). We deliberately do NOT return 409 for
 * lost version races; the user-facing answer is always "did you have
 * the coins or not", checked at write time.
 */
export async function buyItem(
	coupleId: string,
	userId: string | null,
	itemId: string
): Promise<PetMutationResult> {
	const [item] = await db.select().from(petShopItem).where(eq(petShopItem.id, itemId)).limit(1);
	if (!item) throw new PetShopError('item_not_found');
	if (!item.enabled) throw new PetShopError('item_disabled');

	// v1: refuse selling xp buffs since they can't be activated.
	if (item.kind === 'buff') {
		const effect = BUFF_EFFECTS[item.id];
		if (effect && effect.kind === 'xp') throw new PetShopError('item_disabled');
	}

	const stage = await readPetStage(coupleId);
	if (!stageUnlocks(stage, item.minStage as Stage)) {
		throw new PetShopError('item_locked');
	}

	const isStackable = item.kind === 'treat';
	const price = item.priceCoins;
	const itemKind = item.kind as ShopItemKind;
	const itemSlot = item.slot;

	// Provision the wallet outside the retry loop so we never race
	// against the wallet creation itself.
	await ensureWallet(coupleId);

	for (let attempt = 0; attempt < SHOP_RETRY_LIMIT; attempt += 1) {
		try {
			await db.transaction(async (tx) => {
				const [wallet] = await tx
					.select({ coins: petWallet.coins, version: petWallet.version })
					.from(petWallet)
					.where(eq(petWallet.coupleId, coupleId))
					.limit(1);
				if (!wallet) throw new VersionConflictError('wallet');
				if (wallet.coins < price) throw new PetShopError('insufficient_coins');

				const [existingInv] = await tx
					.select({ id: petInventory.id, qty: petInventory.qty })
					.from(petInventory)
					.where(and(eq(petInventory.coupleId, coupleId), eq(petInventory.itemId, itemId)))
					.limit(1);

				if (existingInv && !isStackable) {
					throw new PetShopError('item_already_owned');
				}

				const updated = await tx
					.update(petWallet)
					.set({
						coins: sql`${petWallet.coins} - ${price}`,
						version: wallet.version + 1,
						updatedAt: new Date()
					})
					.where(and(eq(petWallet.coupleId, coupleId), eq(petWallet.version, wallet.version)))
					.returning({ version: petWallet.version });
				if (updated.length === 0) throw new VersionConflictError('wallet');

				await tx.insert(petLedger).values({
					coupleId,
					userId,
					kind: 'spend',
					source: `shop:${itemId}`,
					coinsDelta: -price,
					xpDelta: 0,
					dedupeKey: null
				});

				if (existingInv) {
					await tx
						.update(petInventory)
						.set({ qty: existingInv.qty + 1 })
						.where(eq(petInventory.id, existingInv.id));
				} else {
					await tx.insert(petInventory).values({
						coupleId,
						itemId,
						slot: itemKind === 'cosmetic' ? itemSlot : null,
						qty: 1,
						equipped: false
					});
				}
			});

			return buildMutationResult(coupleId);
		} catch (err) {
			if (err instanceof VersionConflictError) continue;
			throw err;
		}
	}

	// Exhausted retries — treat the same as a balance failure so the
	// user sees a deterministic error rather than a 5xx. This matches
	// the rubber-duck guidance: the user-facing answer is "did you have
	// the coins?", and after 3 attempts we say no.
	throw new PetShopError('insufficient_coins');
}

// ─── equipCosmetic ───────────────────────────────────────────────────────

/**
 * Toggle a cosmetic on/off. Equipping auto-unequips any other item in
 * the same slot in the SAME tx, so the partial unique index
 * `pet_inventory_equipped_slot_uq` is a backstop, not the primary
 * mechanism. Only cosmetics support equip — treats/furniture/buffs
 * raise `item_not_cosmetic`.
 *
 * Idempotent in both directions: equipping an already-equipped item
 * returns success without writing.
 */
export async function equipCosmetic(
	coupleId: string,
	itemId: string,
	equipped: boolean
): Promise<PetMutationResult> {
	const [item] = await db
		.select({ kind: petShopItem.kind, slot: petShopItem.slot })
		.from(petShopItem)
		.where(eq(petShopItem.id, itemId))
		.limit(1);
	if (!item) throw new PetShopError('item_not_found');
	if (item.kind !== 'cosmetic') throw new PetShopError('item_not_cosmetic');
	const slot = item.slot;
	if (!slot) throw new PetShopError('item_not_cosmetic');

	try {
		await db.transaction(async (tx) => {
			const [inv] = await tx
				.select({ id: petInventory.id, qty: petInventory.qty, equipped: petInventory.equipped })
				.from(petInventory)
				.where(and(eq(petInventory.coupleId, coupleId), eq(petInventory.itemId, itemId)))
				.limit(1);
			if (!inv || inv.qty <= 0) throw new PetShopError('inventory_empty');
			if (inv.equipped === equipped) return; // already in target state

			if (equipped) {
				// Drop any other item already occupying this slot.
				await tx
					.update(petInventory)
					.set({ equipped: false })
					.where(
						and(
							eq(petInventory.coupleId, coupleId),
							eq(petInventory.slot, slot),
							eq(petInventory.equipped, true)
						)
					);
			}

			await tx
				.update(petInventory)
				.set({ equipped, slot: equipped ? slot : null })
				.where(eq(petInventory.id, inv.id));

			// Bump pet.version so realtime receivers can detect equip
			// changes via the same monotonic version-gate they use for
			// every other pet mutation. Equipped state is part of the
			// pet's visible appearance — the version bump matches the
			// "every visible mutation increments a version" invariant
			// the snapshot broadcast contract relies on.
			await tx
				.update(pet)
				.set({ version: sql`${pet.version} + 1` })
				.where(eq(pet.coupleId, coupleId));
		});
	} catch (err) {
		// Defensive: the auto-unequip above should make 23505 impossible,
		// but a parallel equip on the same slot could still race. Treat
		// it as a soft conflict — caller can retry from fresh state.
		if (
			err &&
			typeof err === 'object' &&
			'code' in err &&
			(err as { code: string }).code === '23505'
		) {
			throw new PetShopError('inventory_empty', 'equip slot conflict');
		}
		throw err;
	}

	return buildMutationResult(coupleId);
}

// ─── consumeTreat ────────────────────────────────────────────────────────

/**
 * Eat one treat: bump mood, drop hunger, decrement qty (row stays at
 * qty=0, never deleted, so the wardrobe can show "out of stock"). The
 * pet write is the same projectDecay→update pattern `bumpPetAtomic`
 * uses, so mood/hunger always flow forward in time.
 *
 * Treat effects come from `TREAT_EFFECTS` in pet.constants — that is
 * the source of truth, not the price column or the spec text.
 *
 * Errors:
 *   - item_not_found / item_disabled / item_not_treat → 4xx
 *   - inventory_empty                                 → 409
 *   - pet_not_found                                   → 409
 *   - item_locked                                     → 403  (stage gated)
 *   - treat_effect_missing                            → 500-ish (data bug)
 */
export async function consumeTreat(
	coupleId: string,
	userId: string | null,
	itemId: string
): Promise<PetMutationResult> {
	const [item] = await db
		.select({
			kind: petShopItem.kind,
			enabled: petShopItem.enabled,
			minStage: petShopItem.minStage
		})
		.from(petShopItem)
		.where(eq(petShopItem.id, itemId))
		.limit(1);
	if (!item) throw new PetShopError('item_not_found');
	if (!item.enabled) throw new PetShopError('item_disabled');
	if (item.kind !== 'treat') throw new PetShopError('item_not_treat');

	const effect = TREAT_EFFECTS[itemId];
	if (!effect) throw new PetShopError('treat_effect_missing');

	const stage = await readPetStage(coupleId);
	if (!stage) throw new PetShopError('pet_not_found');
	if (!stageUnlocks(stage, item.minStage as Stage)) {
		throw new PetShopError('item_locked');
	}

	for (let attempt = 0; attempt < SHOP_RETRY_LIMIT; attempt += 1) {
		const now = new Date();
		try {
			await db.transaction(async (tx) => {
				const [petRow] = await tx.select().from(pet).where(eq(pet.coupleId, coupleId)).limit(1);
				if (!petRow) throw new PetShopError('pet_not_found');

				const [inv] = await tx
					.select({ id: petInventory.id, qty: petInventory.qty })
					.from(petInventory)
					.where(and(eq(petInventory.coupleId, coupleId), eq(petInventory.itemId, itemId)))
					.limit(1);
				if (!inv || inv.qty <= 0) throw new PetShopError('inventory_empty');

				const projected = projectDecay(
					{
						mood: petRow.mood,
						hunger: petRow.hunger,
						moodUpdatedAt: petRow.moodUpdatedAt,
						hungerUpdatedAt: petRow.hungerUpdatedAt
					},
					now
				);
				const newMood = Math.min(MOOD_CEIL, Math.max(MOOD_FLOOR, projected.mood + effect.mood));
				const newHunger = Math.min(
					HUNGER_CEIL,
					Math.max(HUNGER_FLOOR, projected.hunger - effect.hunger)
				);

				const updated = await tx
					.update(pet)
					.set({
						mood: newMood,
						hunger: newHunger,
						moodUpdatedAt: now,
						hungerUpdatedAt: now,
						version: petRow.version + 1
					})
					.where(and(eq(pet.coupleId, coupleId), eq(pet.version, petRow.version)))
					.returning({ version: pet.version });
				if (updated.length === 0) throw new VersionConflictError('pet');

				const decremented = await tx
					.update(petInventory)
					.set({ qty: inv.qty - 1, equipped: false })
					.where(and(eq(petInventory.id, inv.id), gt(petInventory.qty, 0)))
					.returning({ id: petInventory.id });
				if (decremented.length === 0) throw new PetShopError('inventory_empty');

				await tx.insert(petLedger).values({
					coupleId,
					userId,
					kind: 'spend',
					source: `treat:${itemId}`,
					coinsDelta: 0,
					xpDelta: 0,
					dedupeKey: null
				});
			});

			return buildMutationResult(coupleId, now);
		} catch (err) {
			if (err instanceof VersionConflictError) continue;
			throw err;
		}
	}

	// Pet version contended out — surface as inventory_empty so the
	// caller retries from a fresh GET. This is exceptionally rare since
	// only the partner's earn pipeline writes to pet too.
	throw new PetShopError('inventory_empty', 'pet version contention');
}

// ─── activateBuff (P5.1) ─────────────────────────────────────────────────

/**
 * Burn one buff item from inventory and arm a temporary multiplier.
 *
 * Lifecycle:
 *   1. Validate item is a buff and enabled and we have qty ≥ 1.
 *   2. Look up `BUFF_EFFECTS[itemId]` for kind+multiplier; v1 refuses
 *      kind='xp' with `buff_xp_unavailable` since there's no XP system.
 *   3. In a single tx: decrement inventory qty (row stays at 0 same
 *      pattern as treats), upsert `pet_buff` row with
 *      `active_until = now() + BUFF_DURATION_MS`. Re-activating the
 *      same kind EXTENDS the window from now (does not stack on top
 *      of remaining time — keeps the "always 24h fresh" UX honest).
 *   4. Append a spend ledger row.
 *   5. Bump wallet.version so realtime receivers refetch state.
 *
 * Idempotency: not idempotent — caller must guard against double-fires
 * client-side. Buff items are inexpensive and the risk of an accidental
 * double-activate is just losing one item, not an invariant break.
 */
export async function activateBuff(
	coupleId: string,
	userId: string | null,
	itemId: string
): Promise<PetMutationResult> {
	const [item] = await db
		.select({
			kind: petShopItem.kind,
			enabled: petShopItem.enabled,
			minStage: petShopItem.minStage
		})
		.from(petShopItem)
		.where(eq(petShopItem.id, itemId))
		.limit(1);
	if (!item) throw new PetShopError('item_not_found');
	if (!item.enabled) throw new PetShopError('item_disabled');
	if (item.kind !== 'buff') throw new PetShopError('item_not_buff');

	const effect = BUFF_EFFECTS[itemId];
	if (!effect) throw new PetShopError('buff_effect_missing');

	// v1 has no XP system — buff_xpboost is buyable but not activatable.
	if (effect.kind === 'xp') throw new PetShopError('buff_xp_unavailable');

	const stage = await readPetStage(coupleId);
	if (!stage) throw new PetShopError('pet_not_found');
	if (!stageUnlocks(stage, item.minStage as Stage)) {
		throw new PetShopError('item_locked');
	}

	const multiplier = Math.min(BUFF_MULTIPLIER_CAP, effect.multiplier);
	const activeUntil = new Date(Date.now() + BUFF_DURATION_MS);

	for (let attempt = 0; attempt < SHOP_RETRY_LIMIT; attempt += 1) {
		try {
			await db.transaction(async (tx) => {
				const [inv] = await tx
					.select({ id: petInventory.id, qty: petInventory.qty })
					.from(petInventory)
					.where(and(eq(petInventory.coupleId, coupleId), eq(petInventory.itemId, itemId)))
					.limit(1);
				if (!inv || inv.qty <= 0) throw new PetShopError('inventory_empty');

				const decremented = await tx
					.update(petInventory)
					.set({ qty: inv.qty - 1, equipped: false })
					.where(and(eq(petInventory.id, inv.id), gt(petInventory.qty, 0)))
					.returning({ id: petInventory.id });
				if (decremented.length === 0) throw new PetShopError('inventory_empty');

				// Upsert: same (couple, kind) → bump activeUntil/multiplier.
				// Spec note: re-activating refreshes the 24h window, not
				// stacks on remaining time.
				await tx
					.insert(petBuff)
					.values({
						coupleId,
						kind: effect.kind,
						multiplier: multiplier.toFixed(2),
						activeUntil
					})
					.onConflictDoUpdate({
						target: [petBuff.coupleId, petBuff.kind],
						set: { multiplier: multiplier.toFixed(2), activeUntil }
					});

				await tx.insert(petLedger).values({
					coupleId,
					userId,
					kind: 'spend',
					source: `buff:${itemId}`,
					coinsDelta: 0,
					xpDelta: 0,
					dedupeKey: null
				});

				// Bump wallet.version so realtime receivers re-fetch — the
				// buff itself doesn't appear in PetSnapshot today, but the
				// receiver's coins-projection logic should be re-fetched
				// to get the new buff state (and pulse the inventory list).
				await bumpWalletAtomic(tx, coupleId, 0);
			});

			return buildMutationResult(coupleId);
		} catch (err) {
			if (err instanceof VersionConflictError) continue;
			throw err;
		}
	}

	throw new PetShopError('inventory_empty', 'wallet version contention');
}
