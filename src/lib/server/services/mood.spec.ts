import { describe, it, expect } from 'vitest';
import { isMood, MOODS, DEDUPE_WINDOW_MS, MAX_TREND_DAYS } from './mood';

describe('mood module — pure surface', () => {
	it('exposes exactly the 5 documented buckets in a stable order', () => {
		expect(MOODS).toEqual(['joyful', 'happy', 'neutral', 'sad', 'upset']);
	});

	it('isMood accepts only the 5 buckets', () => {
		for (const m of MOODS) expect(isMood(m)).toBe(true);
	});

	it('isMood rejects unknown strings, empty, and non-strings', () => {
		expect(isMood('happiness')).toBe(false);
		expect(isMood('')).toBe(false);
		expect(isMood(undefined)).toBe(false);
		expect(isMood(null)).toBe(false);
		expect(isMood(42)).toBe(false);
		expect(isMood({ mood: 'happy' })).toBe(false);
		// Defends against case sensitivity drift — DB CHECK is lowercase.
		expect(isMood('Happy')).toBe(false);
	});

	it('exposes a sane dedupe window (anti-spam) — at least 30s, at most 5min', () => {
		expect(DEDUPE_WINDOW_MS).toBeGreaterThanOrEqual(30_000);
		expect(DEDUPE_WINDOW_MS).toBeLessThanOrEqual(300_000);
	});

	it('caps trend lookback to bound query cost', () => {
		expect(MAX_TREND_DAYS).toBeGreaterThan(0);
		expect(MAX_TREND_DAYS).toBeLessThanOrEqual(365);
	});
});
