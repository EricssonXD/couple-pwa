import { describe, expect, it } from 'vitest';
import {
	bucketOf,
	currentBucket,
	deriveSelectedHour,
	hourLabel,
	isCurrentHour,
	isFuture,
	nextHour,
	prevHour,
	relativeLabel
} from './dayNav';

const NOW = new Date('2026-05-16T18:42:11Z');
const HOUR = '2026-05-16T18:00:00Z';
const PREV = '2026-05-16T17:00:00Z';
const NEXT = '2026-05-16T19:00:00Z';

describe('bucketOf / currentBucket', () => {
	it('truncates to the hour in UTC', () => {
		expect(bucketOf(NOW)).toBe(HOUR);
		expect(currentBucket(NOW)).toBe(HOUR);
	});

	it('rolls over correctly at the day boundary', () => {
		expect(bucketOf(new Date('2026-05-17T00:05:00Z'))).toBe('2026-05-17T00:00:00Z');
		expect(bucketOf(new Date('2026-05-16T23:59:59Z'))).toBe('2026-05-16T23:00:00Z');
	});
});

describe('prevHour / nextHour', () => {
	it('walks adjacent buckets', () => {
		expect(prevHour(HOUR)).toBe(PREV);
		expect(nextHour(HOUR)).toBe(NEXT);
	});

	it('crosses day boundaries', () => {
		expect(prevHour('2026-05-17T00:00:00Z')).toBe('2026-05-16T23:00:00Z');
		expect(nextHour('2026-05-16T23:00:00Z')).toBe('2026-05-17T00:00:00Z');
	});

	it('round-trips', () => {
		expect(nextHour(prevHour(HOUR))).toBe(HOUR);
		expect(prevHour(nextHour(HOUR))).toBe(HOUR);
	});
});

describe('isFuture / isCurrentHour', () => {
	it('classifies relative to now', () => {
		expect(isFuture(PREV, NOW)).toBe(false);
		expect(isFuture(HOUR, NOW)).toBe(false);
		expect(isFuture(NEXT, NOW)).toBe(true);
		expect(isCurrentHour(HOUR, NOW)).toBe(true);
		expect(isCurrentHour(PREV, NOW)).toBe(false);
		expect(isCurrentHour(NEXT, NOW)).toBe(false);
	});
});

describe('hourLabel', () => {
	it('renders English 12-hour labels', () => {
		// 18:00 UTC → 18:00 in UTC tz = 6:00 PM
		expect(hourLabel(HOUR, 'en', 'UTC')).toMatch(/6:00\s?PM/);
	});

	it('respects the supplied tz', () => {
		// 18:00 UTC → 02:00 next-day in Asia/Hong_Kong (UTC+8)
		expect(hourLabel(HOUR, 'en', 'Asia/Hong_Kong')).toMatch(/2:00\s?AM/);
	});
});

describe('relativeLabel', () => {
	it('returns now for the current hour', () => {
		expect(relativeLabel(HOUR, NOW)).toEqual({ kind: 'now' });
	});
	it('returns hours_ago for same-day past', () => {
		expect(relativeLabel(PREV, NOW)).toEqual({ kind: 'hours_ago', n: 1 });
	});
	it('returns yesterday at the 24h mark', () => {
		const y = '2026-05-15T18:00:00Z';
		expect(relativeLabel(y, NOW)).toEqual({ kind: 'yesterday' });
	});
	it('returns days_ago beyond yesterday', () => {
		const d = '2026-05-13T18:00:00Z';
		expect(relativeLabel(d, NOW)).toEqual({ kind: 'days_ago', n: 3 });
	});
	it('returns future for ahead buckets', () => {
		expect(relativeLabel(NEXT, NOW)).toEqual({ kind: 'future' });
	});
});

describe('deriveSelectedHour', () => {
	it('snaps to current when no selection', () => {
		expect(deriveSelectedHour({ now: NOW })).toBe(HOUR);
		expect(deriveSelectedHour({ now: NOW, selected: null })).toBe(HOUR);
	});
	it('preserves a valid past selection', () => {
		expect(deriveSelectedHour({ now: NOW, selected: PREV })).toBe(PREV);
	});
	it('snaps back to current for future selections', () => {
		expect(deriveSelectedHour({ now: NOW, selected: NEXT })).toBe(HOUR);
	});
});
