import { describe, it, expect } from 'vitest';
import {
	dayDiffUTC,
	allMilestones,
	nextMilestone,
	pastMilestones,
	futureMilestones,
	isMilestoneToday,
	daysTogether,
	resolveBaseDate,
	DAY_MILESTONES,
	YEAR_MILESTONES
} from './milestones';

describe('milestones (pure)', () => {
	const base = new Date('2024-01-15T00:00:00Z');

	describe('dayDiffUTC', () => {
		it('returns 0 for same day', () => {
			expect(dayDiffUTC(new Date('2024-01-15T03:00:00Z'), new Date('2024-01-15T22:00:00Z'))).toBe(
				0
			);
		});

		it('returns positive forward diff in whole days (UTC)', () => {
			expect(dayDiffUTC(new Date('2024-01-15T00:00:00Z'), new Date('2024-01-25T00:00:00Z'))).toBe(
				10
			);
		});

		it('returns negative for backward diff', () => {
			expect(dayDiffUTC(new Date('2024-01-25T00:00:00Z'), new Date('2024-01-15T00:00:00Z'))).toBe(
				-10
			);
		});
	});

	describe('resolveBaseDate', () => {
		it('prefers anniversary when present', () => {
			const r = resolveBaseDate('2024-01-15', new Date('2025-12-31'));
			expect(r.getUTCFullYear()).toBe(2024);
		});

		it('falls back to coupleSince when anniversary is null', () => {
			const r = resolveBaseDate(null, new Date('2025-06-30T00:00:00Z'));
			expect(r.getUTCFullYear()).toBe(2025);
			expect(r.getUTCMonth()).toBe(5);
		});
	});

	describe('allMilestones', () => {
		const milestones = allMilestones(base);

		it('contains every day + year milestone exactly once', () => {
			expect(milestones.length).toBe(DAY_MILESTONES.length + YEAR_MILESTONES.length);
		});

		it('is sorted ascending by date', () => {
			for (let i = 1; i < milestones.length; i++) {
				expect(milestones[i].date.getTime()).toBeGreaterThanOrEqual(
					milestones[i - 1].date.getTime()
				);
			}
		});

		it('day-100 milestone lands exactly 100 days after base', () => {
			const m100 = milestones.find((m) => m.kind === 'days' && m.n === 100)!;
			expect(dayDiffUTC(base, m100.date)).toBe(100);
		});

		it('1-year milestone lands one calendar year after base', () => {
			const y1 = milestones.find((m) => m.kind === 'years' && m.n === 1)!;
			expect(y1.date.getUTCFullYear()).toBe(base.getUTCFullYear() + 1);
			expect(y1.date.getUTCMonth()).toBe(base.getUTCMonth());
			expect(y1.date.getUTCDate()).toBe(base.getUTCDate());
		});
	});

	describe('past / future / next', () => {
		const milestones = allMilestones(base);

		it('separates past and future cleanly', () => {
			const today = new Date('2024-06-01T00:00:00Z'); // ~138 days in
			const past = pastMilestones(milestones, today);
			const fut = futureMilestones(milestones, today);
			expect(past.length + fut.length).toBe(milestones.length);
			expect(
				past.every((m) => dayDiffUTC(m.date, today) <= 0 || dayDiffUTC(m.date, today) >= 0)
			).toBe(true);
		});

		it('past includes 100-day at June 1 but not 200-day', () => {
			const today = new Date('2024-06-01T00:00:00Z');
			const past = pastMilestones(milestones, today);
			expect(past.find((m) => m.n === 100 && m.kind === 'days')).toBeTruthy();
			expect(past.find((m) => m.n === 200 && m.kind === 'days')).toBeFalsy();
		});

		it('nextMilestone returns the chronologically nearest future one', () => {
			const today = new Date('2024-06-01T00:00:00Z');
			const next = nextMilestone(milestones, today);
			expect(next).toBeTruthy();
			expect(next!.kind).toBe('days');
			expect(next!.n).toBe(200);
		});

		it('nextMilestone returns null when all are past', () => {
			const today = new Date('2200-01-01T00:00:00Z');
			expect(nextMilestone(milestones, today)).toBeNull();
		});
	});

	describe('isMilestoneToday', () => {
		it('detects exact-day match', () => {
			const milestones = allMilestones(base);
			const m100 = milestones.find((m) => m.kind === 'days' && m.n === 100)!;
			expect(isMilestoneToday(milestones, m100.date)).toBe(true);
		});

		it('returns false for an arbitrary day', () => {
			const milestones = allMilestones(base);
			expect(isMilestoneToday(milestones, new Date('2024-02-01T00:00:00Z'))).toBe(false);
		});
	});

	describe('daysTogether', () => {
		it('counts whole days, never negative', () => {
			expect(daysTogether(base, new Date('2024-01-25T00:00:00Z'))).toBe(10);
			expect(daysTogether(base, new Date('2023-12-15T00:00:00Z'))).toBe(0);
		});
	});
});
