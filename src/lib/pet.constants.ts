// DuoSync — shared pet constants + pure helpers (client + server).
// Values here ARE the source of truth; tests assert these constants,
// never literal numbers. See pet-system.md §1, §2 (decay), §4 (W1, W2).

export const SPECIES = ['fox', 'cat', 'bird', 'capybara'] as const;
export type Species = (typeof SPECIES)[number];

export const STAGES = ['egg', 'baby', 'grown'] as const;
export type Stage = (typeof STAGES)[number];

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
