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

import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { pet, petInventory, petLedger, petWallet } from '$lib/server/db/schema';
import { broadcastToCouple } from '$lib/server/realtime';
import {
	NAME_MAX,
	NAME_MIN,
	SPECIES,
	WELCOME_BACK_DEDUPE_DAYS,
	WELCOME_BACK_INACTIVE_DAYS,
	WELCOME_BACK_TREAT_ID,
	projectDecay,
	stageForXp,
	todayKey,
	type EquippedItem,
	type PetPublic,
	type PetSnapshot,
	type Species,
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
	welcomeBack: PetSnapshot['welcomeBack'] = null
): Promise<PetSnapshot> {
	const now = new Date();
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
	} catch (err) {
		console.warn('[pet] broadcastPetState failed', err);
	}
}
