import { describe, it, expect } from 'vitest';
import { computeStreak, MAX_STREAK_LOOKBACK_DAYS } from './connection';

function days(...keys: string[]): Set<string> {
	return new Set(keys);
}

describe('computeStreak (pure)', () => {
	const today = '2025-03-15';

	it('returns 0 when activeDays is empty', () => {
		expect(computeStreak(new Set(), today)).toBe(0);
	});

	it('counts a single-day streak when only today is active', () => {
		expect(computeStreak(days(today), today)).toBe(1);
	});

	it('counts consecutive days ending today', () => {
		expect(computeStreak(days('2025-03-15', '2025-03-14', '2025-03-13'), today)).toBe(3);
	});

	it('grants a one-day grace for today (yesterday-active still counts)', () => {
		// today itself NOT active, but yesterday is — streak = days from yesterday back.
		expect(computeStreak(days('2025-03-14', '2025-03-13'), today)).toBe(2);
	});

	it('breaks the streak when both today AND yesterday are missing', () => {
		expect(computeStreak(days('2025-03-13', '2025-03-12'), today)).toBe(0);
	});

	it('stops at the first gap inside the streak (after grace consumed)', () => {
		// active: today, yesterday — gap — earlier days. Streak = 2.
		expect(computeStreak(days('2025-03-15', '2025-03-14', '2025-03-12', '2025-03-11'), today)).toBe(
			2
		);
	});

	it('handles month-boundary correctly (UTC)', () => {
		const day = '2025-03-01';
		expect(computeStreak(days('2025-03-01', '2025-02-28', '2025-02-27'), day)).toBe(3);
	});

	it('handles year-boundary correctly (UTC)', () => {
		const day = '2025-01-01';
		expect(computeStreak(days('2025-01-01', '2024-12-31', '2024-12-30'), day)).toBe(3);
	});

	it('caps at the lookback window even with infinite-active input', () => {
		// Build an active set covering the full lookback window + a margin.
		const big = new Set<string>();
		const start = new Date('2025-03-15T00:00:00Z');
		for (let i = 0; i < MAX_STREAK_LOOKBACK_DAYS + 10; i++) {
			const d = new Date(start);
			d.setUTCDate(d.getUTCDate() - i);
			big.add(d.toISOString().slice(0, 10));
		}
		const streak = computeStreak(big, today);
		expect(streak).toBeLessThanOrEqual(MAX_STREAK_LOOKBACK_DAYS + 2);
		expect(streak).toBeGreaterThanOrEqual(MAX_STREAK_LOOKBACK_DAYS);
	});

	it('does not double-count today when grace was consumed', () => {
		// today active + yesterday active → 2 (not 3).
		expect(computeStreak(days('2025-03-15', '2025-03-14'), today)).toBe(2);
	});
});
