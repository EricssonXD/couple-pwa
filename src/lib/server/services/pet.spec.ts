// Pure-surface tests for the pet service. DB-touching paths
// (getPetState, hatchPet, renamePet, maybeGrantWelcomeBack) are
// exercised in integration tests; here we only assert the validation
// invariants, decay math, and exported constants.

import { describe, expect, it, vi } from 'vitest';
import {
	DECAY_PER_DAY,
	EARN_SOURCES,
	EARN_TABLE,
	HUNGER_CEIL,
	HUNGER_FLOOR,
	MOOD_CEIL,
	MOOD_FLOOR,
	NAME_MAX,
	NAME_MIN,
	SPECIES,
	STAGE_THRESHOLDS,
	STAGES,
	TREAT_EFFECTS,
	WELCOME_BACK_DEDUPE_DAYS,
	WELCOME_BACK_INACTIVE_DAYS,
	WELCOME_BACK_TREAT_ID,
	computePay,
	isSpecies,
	projectDecay,
	stageForXp,
	todayKey
} from '$lib/pet.constants';

vi.mock('$lib/server/realtime', () => ({
	broadcastToCouple: vi.fn().mockResolvedValue(undefined),
	topicForCouple: (id: string) => `couple:${id}`
}));

describe('pet constants', () => {
	it('SPECIES is the locked 4-species set', () => {
		expect(SPECIES).toEqual(['fox', 'cat', 'bird', 'capybara']);
	});

	it('STAGES are the 3 documented stages', () => {
		expect(STAGES).toEqual(['egg', 'baby', 'grown']);
	});

	it('NAME bounds match the SQL CHECK (1..24 chars)', () => {
		expect(NAME_MIN).toBe(1);
		expect(NAME_MAX).toBe(24);
	});

	it('STAGE_THRESHOLDS match the design doc', () => {
		expect(STAGE_THRESHOLDS).toEqual({ egg: 0, baby: 50, grown: 250 });
	});

	it('decay rate + floor/ceiling clamp at the documented values', () => {
		expect(DECAY_PER_DAY).toBe(5);
		expect(MOOD_FLOOR).toBe(20);
		expect(MOOD_CEIL).toBe(100);
		expect(HUNGER_FLOOR).toBe(0);
		expect(HUNGER_CEIL).toBe(80);
	});

	it('welcome-back cadence is at most quarterly', () => {
		expect(WELCOME_BACK_INACTIVE_DAYS).toBe(60);
		expect(WELCOME_BACK_DEDUPE_DAYS).toBe(90);
		expect(WELCOME_BACK_TREAT_ID).toBe('treat_strawberry');
	});
});

describe('isSpecies', () => {
	it('accepts the 4 documented species', () => {
		for (const s of SPECIES) expect(isSpecies(s)).toBe(true);
	});
	it('rejects unknown strings, casing drift, and non-strings', () => {
		expect(isSpecies('Fox')).toBe(false);
		expect(isSpecies('dragon')).toBe(false);
		expect(isSpecies('')).toBe(false);
		expect(isSpecies(null)).toBe(false);
		expect(isSpecies(undefined)).toBe(false);
		expect(isSpecies(42)).toBe(false);
		expect(isSpecies({})).toBe(false);
	});
});

describe('stageForXp', () => {
	it('maps xp to stage using the ≥ thresholds', () => {
		expect(stageForXp(0)).toBe('egg');
		expect(stageForXp(49)).toBe('egg');
		expect(stageForXp(50)).toBe('baby');
		expect(stageForXp(249)).toBe('baby');
		expect(stageForXp(250)).toBe('grown');
		expect(stageForXp(10_000)).toBe('grown');
	});
});

describe('todayKey', () => {
	it('formats a UTC YYYY-MM-DD', () => {
		expect(todayKey(new Date('2024-11-04T12:30:00Z'))).toBe('2024-11-04');
	});
	it('uses UTC even when the input wall-time would roll over', () => {
		// 23:30 in HK (UTC+8) on Nov 4 is 15:30 UTC same day.
		expect(todayKey(new Date('2024-11-04T15:30:00Z'))).toBe('2024-11-04');
		// Just past midnight UTC.
		expect(todayKey(new Date('2024-11-05T00:01:00Z'))).toBe('2024-11-05');
	});
});

describe('projectDecay', () => {
	const baseStored = {
		mood: 80,
		hunger: 20,
		moodUpdatedAt: new Date('2024-11-01T00:00:00Z'),
		hungerUpdatedAt: new Date('2024-11-01T00:00:00Z')
	};

	it('returns the stored values floored when no time has passed', () => {
		const out = projectDecay(baseStored, new Date('2024-11-01T00:00:00Z'));
		expect(out).toEqual({ mood: 80, hunger: 20 });
	});

	it('decays mood -5/day and increases hunger +5/day', () => {
		const oneDay = new Date('2024-11-02T00:00:00Z');
		const out = projectDecay(baseStored, oneDay);
		expect(out).toEqual({ mood: 75, hunger: 25 });
	});

	it('never drops mood below MOOD_FLOOR even after 100 days', () => {
		const out = projectDecay(baseStored, new Date('2025-02-09T00:00:00Z'));
		expect(out.mood).toBe(MOOD_FLOOR);
	});

	it('never raises hunger above HUNGER_CEIL even after 100 days', () => {
		const out = projectDecay(baseStored, new Date('2025-02-09T00:00:00Z'));
		expect(out.hunger).toBe(HUNGER_CEIL);
	});

	it('clamps negative time delta (clock skew) to 0 days — no free mood top-up', () => {
		// `now` is in the past relative to the stored timestamps.
		const out = projectDecay(baseStored, new Date('2024-10-01T00:00:00Z'));
		expect(out).toEqual({ mood: 80, hunger: 20 });
	});

	it('returns Math.floor-ed integers — server (int) and client converge bit-for-bit', () => {
		// 0.5 days → mood drops 2.5 → floor(77.5) = 77.
		const halfDay = new Date('2024-11-01T12:00:00Z');
		const out = projectDecay(baseStored, halfDay);
		expect(Number.isInteger(out.mood)).toBe(true);
		expect(Number.isInteger(out.hunger)).toBe(true);
		expect(out.mood).toBe(77);
		expect(out.hunger).toBe(22);
	});

	it('mood and hunger decay independently of each other', () => {
		const stored = {
			mood: 80,
			hunger: 20,
			moodUpdatedAt: new Date('2024-11-01T00:00:00Z'),
			hungerUpdatedAt: new Date('2024-11-03T00:00:00Z')
		};
		// 2 days for mood, 0 days for hunger.
		const out = projectDecay(stored, new Date('2024-11-03T00:00:00Z'));
		expect(out).toEqual({ mood: 70, hunger: 20 });
	});
});

describe('PetValidationError + normalizers', () => {
	it('round-trips every documented error code', async () => {
		const { PetValidationError } = await import('./pet');
		type Code = InstanceType<typeof PetValidationError>['code'];
		const codes: Code[] = [
			'species_invalid',
			'name_empty',
			'name_too_long',
			'pet_already_exists',
			'pet_not_found'
		];
		for (const c of codes) {
			const e = new PetValidationError('x', c);
			expect(e.code).toBe(c);
			expect(e.name).toBe('PetValidationError');
			expect(e instanceof Error).toBe(true);
		}
	});

	it('normalizeSpecies accepts the 4 species, rejects everything else', async () => {
		const { normalizeSpecies, PetValidationError } = await import('./pet');
		for (const s of SPECIES) expect(normalizeSpecies(s)).toBe(s);
		for (const bad of ['Fox', 'dragon', '', null, 42, {}]) {
			expect(() => normalizeSpecies(bad)).toThrowError(PetValidationError);
		}
	});

	it('normalizeName trims, strips newlines, NFKC-normalises, enforces 1..24', async () => {
		const { normalizeName, PetValidationError } = await import('./pet');
		expect(normalizeName('  Mochi  ')).toBe('Mochi');
		expect(normalizeName('Mo\nchi')).toBe('Mochi');
		// 'Ｍｏｃｈｉ' (full-width) → NFKC → 'Mochi'
		expect(normalizeName('Ｍｏｃｈｉ')).toBe('Mochi');
		// Empty / whitespace-only / non-string
		for (const bad of ['', '   ', '\n\n', null, undefined, 42]) {
			expect(() => normalizeName(bad)).toThrowError(PetValidationError);
		}
		// 25 chars → too long
		expect(() => normalizeName('a'.repeat(25))).toThrowError(PetValidationError);
		// 24 chars → ok
		expect(normalizeName('a'.repeat(24))).toHaveLength(24);
	});
});

describe('broadcastPetState — couple.status gate (B1)', () => {
	it('skips the broadcast when status is not "active"', async () => {
		const realtime = await import('$lib/server/realtime');
		const { broadcastPetState } = await import('./pet');
		(realtime.broadcastToCouple as ReturnType<typeof vi.fn>).mockClear();
		await broadcastPetState('couple-id-1', 'paused');
		await broadcastPetState('couple-id-1', 'broken');
		await broadcastPetState('couple-id-1', 'unknown-status');
		expect(realtime.broadcastToCouple).not.toHaveBeenCalled();
	});
	// The active-path is integration-tested (it touches the DB); we
	// only assert the gate here so adding new statuses doesn't
	// silently start broadcasting.
});

describe('EARN_TABLE (P2.3 — economy values)', () => {
	it('covers exactly the 7 documented sources, no extras', () => {
		expect(EARN_SOURCES).toEqual([
			'daily_send',
			'daily_reveal',
			'mood_log',
			'quiz_complete',
			'bucket_complete',
			'repair_complete',
			'anniversary'
		]);
		expect(Object.keys(EARN_TABLE).sort()).toEqual([...EARN_SOURCES].sort());
	});

	it('matches the locked earning table in pet-system.md §1', () => {
		expect(EARN_TABLE.daily_send).toEqual({ coinsFull: 2, xpFull: 1, mutualOnly: false });
		expect(EARN_TABLE.daily_reveal).toEqual({ coinsFull: 8, xpFull: 4, mutualOnly: true });
		expect(EARN_TABLE.mood_log).toEqual({ coinsFull: 1, xpFull: 1, mutualOnly: false });
		expect(EARN_TABLE.quiz_complete).toEqual({ coinsFull: 12, xpFull: 8, mutualOnly: true });
		expect(EARN_TABLE.bucket_complete).toEqual({ coinsFull: 6, xpFull: 3, mutualOnly: true });
		expect(EARN_TABLE.repair_complete).toEqual({ coinsFull: 10, xpFull: 5, mutualOnly: true });
		expect(EARN_TABLE.anniversary).toEqual({ coinsFull: 25, xpFull: 12, mutualOnly: true });
	});

	it('every grant has non-negative coins + xp (no penalty rewards)', () => {
		for (const src of EARN_SOURCES) {
			expect(EARN_TABLE[src].coinsFull).toBeGreaterThanOrEqual(0);
			expect(EARN_TABLE[src].xpFull).toBeGreaterThanOrEqual(0);
		}
	});
});

describe('computePay — solo halving rule', () => {
	it('mutual = true pays the full table values', () => {
		for (const src of EARN_SOURCES) {
			const row = EARN_TABLE[src];
			expect(computePay(src, true)).toEqual({
				coinsDelta: row.coinsFull,
				xpDelta: row.xpFull
			});
		}
	});

	it('mutual = false pays Math.floor(full / 2) for both coins and xp', () => {
		for (const src of EARN_SOURCES) {
			const row = EARN_TABLE[src];
			expect(computePay(src, false)).toEqual({
				coinsDelta: Math.floor(row.coinsFull / 2),
				xpDelta: Math.floor(row.xpFull / 2)
			});
		}
	});

	it('halved odd values round DOWN (no float drift, no over-credit)', () => {
		// daily_send coinsFull=2 → solo=1; xpFull=1 → solo=0.
		expect(computePay('daily_send', false)).toEqual({ coinsDelta: 1, xpDelta: 0 });
		// repair_complete coinsFull=10 xp=5 → solo (5, 2). xp 5/2 floors to 2.
		expect(computePay('repair_complete', false)).toEqual({ coinsDelta: 5, xpDelta: 2 });
		// mood_log 1/1 → solo 0/0 (allowed; caller shouldn't hit solo here).
		expect(computePay('mood_log', false)).toEqual({ coinsDelta: 0, xpDelta: 0 });
	});
});

describe('TREAT_EFFECTS', () => {
	it('covers every seeded treat from 0022_pet.sql', () => {
		expect(Object.keys(TREAT_EFFECTS).sort()).toEqual([
			'treat_cake',
			'treat_dumpling',
			'treat_strawberry'
		]);
	});
	it('every treat is positive-mood + positive-hunger-reduction', () => {
		for (const id of Object.keys(TREAT_EFFECTS)) {
			expect(TREAT_EFFECTS[id].mood).toBeGreaterThan(0);
			expect(TREAT_EFFECTS[id].hunger).toBeGreaterThan(0);
		}
	});
	it('welcome-back treat is in the table (consistency)', () => {
		expect(TREAT_EFFECTS[WELCOME_BACK_TREAT_ID]).toBeDefined();
	});
});
