// DuoSync — shared pet constants + pure helpers (client + server).
// Values here ARE the source of truth; tests assert these constants,
// never literal numbers. See pet-system.md §1, §2 (decay), §4 (W1, W2).

export const SPECIES = ['fox', 'cat', 'bird', 'capybara'] as const;
export type Species = (typeof SPECIES)[number];

export const STAGES = ['egg', 'baby', 'grown'] as const;
export type Stage = (typeof STAGES)[number];

// Sprite mood buckets — derived from the continuous mood number that
// the server stores. `mood` ranges MOOD_FLOOR..MOOD_CEIL (20..100).
// Three buckets keep the sprite set small (3 frames per stage) and
// match the placeholder art pipeline in pet-system.md §"SVG pipeline".
export const MOOD_KEYS = ['happy', 'neutral', 'sad'] as const;
export type MoodKey = (typeof MOOD_KEYS)[number];

/** Map a numeric mood to its sprite bucket. */
export function moodKeyFor(mood: number): MoodKey {
	if (mood >= 70) return 'happy';
	if (mood >= 45) return 'neutral';
	return 'sad';
}

// XP thresholds: stage = highest threshold the xp meets.
export const STAGE_THRESHOLDS: Record<Stage, number> = {
	egg: 0,
	baby: 50,
	grown: 250
};

export const NAME_MIN = 1;
export const NAME_MAX = 24;

// Decay (Tamagotchi-lite, never lethal). See §1 Mood/hunger decay.
export const DECAY_PER_DAY = 5;
export const MOOD_FLOOR = 20;
export const MOOD_CEIL = 100;
export const HUNGER_FLOOR = 0;
export const HUNGER_CEIL = 80;

// Welcome-back (W2). Inactivity cutoff for the inviting Notice; dedupe
// window so a partner can't be granted multiple welcome treats in
// rapid succession.
export const WELCOME_BACK_INACTIVE_DAYS = 60;
export const WELCOME_BACK_DEDUPE_DAYS = 90;
export const WELCOME_BACK_TREAT_ID = 'treat_strawberry';

// ─── Earn table (P2.3) ────────────────────────────────────────────────────
// Each ritual that grants coins/XP. `coinsFull` and `xpFull` are the
// MUTUAL pay; solo callers earn `Math.floor(coinsFull / 2)` and
// `Math.floor(xpFull / 2)`. `mutualOnly: true` actions assert the
// caller passed `mutual: true` (defensive — the dedupe key shape and
// call site already gate this, so a `false` here is a programmer
// error). All numbers are tunable from this file alone — tests assert
// the constants, never literals (see pet-system.md §1 earning table).

export const EARN_SOURCES = [
	'daily_send',
	'daily_reveal',
	'mood_log',
	'quiz_complete',
	'bucket_complete',
	'repair_complete',
	'anniversary'
] as const;
export type EarnSource = (typeof EARN_SOURCES)[number];

export const EARN_TABLE: Record<
	EarnSource,
	{ coinsFull: number; xpFull: number; mutualOnly: boolean }
> = {
	daily_send: { coinsFull: 2, xpFull: 1, mutualOnly: false },
	daily_reveal: { coinsFull: 8, xpFull: 4, mutualOnly: true },
	mood_log: { coinsFull: 1, xpFull: 1, mutualOnly: false },
	quiz_complete: { coinsFull: 12, xpFull: 8, mutualOnly: true },
	bucket_complete: { coinsFull: 6, xpFull: 3, mutualOnly: true },
	repair_complete: { coinsFull: 10, xpFull: 5, mutualOnly: true },
	anniversary: { coinsFull: 25, xpFull: 12, mutualOnly: true }
};

/**
 * Halving rule for solo actions. Mutual pays full; solo pays
 * `Math.floor(full / 2)` so a 1-XP action still grants something
 * (Math.floor(1/2)=0; callers that care emit `mood_log` only when
 * they have a non-zero contribution).
 */
export function computePay(
	source: EarnSource,
	mutual: boolean
): { coinsDelta: number; xpDelta: number } {
	const row = EARN_TABLE[source];
	if (mutual) return { coinsDelta: row.coinsFull, xpDelta: row.xpFull };
	return {
		coinsDelta: Math.floor(row.coinsFull / 2),
		xpDelta: Math.floor(row.xpFull / 2)
	};
}

// ─── Treat effects (P2.3) ─────────────────────────────────────────────────
// Mood/hunger deltas applied when a treat is consumed. Hunger is
// SUBTRACTED (treats reduce hunger toward HUNGER_FLOOR). Items not
// listed here are inert (cosmetics/furniture). Treat IDs match the
// seed in 0022_pet.sql.

export const TREAT_EFFECTS: Record<string, { mood: number; hunger: number }> = {
	treat_strawberry: { mood: 8, hunger: 12 },
	treat_dumpling: { mood: 12, hunger: 20 },
	treat_cake: { mood: 18, hunger: 30 }
};

const MS_PER_DAY = 86_400_000;

function clamp(n: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, n));
}

/**
 * Project mood/hunger from their last-write timestamps to `now`.
 * - Days are clamped to ≥ 0 so a stale clock can never *increase* mood.
 * - Output is `Math.floor`-ed so server (Postgres int) and client
 *   (rune effect) converge bit-for-bit (W1).
 * - The pet can never look "ill": mood ≥ MOOD_FLOOR, hunger ≤ HUNGER_CEIL.
 */
export function projectDecay(
	stored: { mood: number; hunger: number; moodUpdatedAt: Date; hungerUpdatedAt: Date },
	now: Date
): { mood: number; hunger: number } {
	const moodDays = Math.max(0, (now.getTime() - stored.moodUpdatedAt.getTime()) / MS_PER_DAY);
	const hungerDays = Math.max(0, (now.getTime() - stored.hungerUpdatedAt.getTime()) / MS_PER_DAY);
	return {
		mood: Math.floor(clamp(stored.mood - DECAY_PER_DAY * moodDays, MOOD_FLOOR, MOOD_CEIL)),
		hunger: Math.floor(clamp(stored.hunger + DECAY_PER_DAY * hungerDays, HUNGER_FLOOR, HUNGER_CEIL))
	};
}

export function stageForXp(xp: number): Stage {
	if (xp >= STAGE_THRESHOLDS.grown) return 'grown';
	if (xp >= STAGE_THRESHOLDS.baby) return 'baby';
	return 'egg';
}

export function isSpecies(v: unknown): v is Species {
	return typeof v === 'string' && (SPECIES as readonly string[]).includes(v);
}

/** UTC YYYY-MM-DD — used for daily dedupe keys. Server-side authority. */
export function todayKey(d: Date = new Date()): string {
	const y = d.getUTCFullYear();
	const m = String(d.getUTCMonth() + 1).padStart(2, '0');
	const day = String(d.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${day}`;
}

// ─── Wire shapes (shared by REST + realtime broadcast) ────────────────────
// Dates serialize as ISO8601 strings to keep the broadcast envelope
// JSON-clean. Server sends strings; client converts to Date when
// re-projecting decay locally.

export type PetPublic = {
	id: string;
	coupleId: string;
	species: Species;
	name: string;
	stage: Stage;
	xp: number;
	mood: number;
	hunger: number;
	moodUpdatedAt: string;
	hungerUpdatedAt: string;
	version: number;
	hatchedAt: string;
};

export type WalletPublic = {
	coupleId: string;
	coins: number;
	lifetimeEarned: number;
	version: number;
	updatedAt: string;
};

export type EquippedItem = {
	itemId: string;
	slot: string | null;
};

export type PetSnapshot = {
	pet: PetPublic | null;
	wallet: WalletPublic;
	equipped: EquippedItem[];
	serverNow: string;
	welcomeBack: { granted: true; treatId: string } | null;
};
