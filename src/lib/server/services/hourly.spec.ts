// F11 — pure-helper unit tests for the hourly service.
//
// Touch only deterministic, non-IO functions (bucket math, path
// formatting, validators). The IO parts (issueUploadAttempt /
// finalizeClipAttempt / getDay) require a live DB + Storage and are
// covered by integration tests.

import { describe, expect, it } from 'vitest';
import {
	HOURLY_ALLOWED_MIMES,
	HOURLY_MOODS,
	buildStorageKey,
	currentHourBucket,
	formatHourPath,
	isHourlyMime,
	isHourlyMood,
	secondsUntilBoundary
} from './hourly';

describe('currentHourBucket', () => {
	it('truncates to the start of the UTC hour', () => {
		const now = new Date('2025-04-15T14:37:42.123Z');
		const b = currentHourBucket(now);
		expect(b.toISOString()).toBe('2025-04-15T14:00:00.000Z');
	});

	it('handles exact hour boundaries', () => {
		const now = new Date('2025-04-15T14:00:00.000Z');
		expect(currentHourBucket(now).toISOString()).toBe('2025-04-15T14:00:00.000Z');
	});
});

describe('formatHourPath', () => {
	it('produces YYYYMMDDHH (UTC, no separators)', () => {
		expect(formatHourPath(new Date('2025-04-15T14:00:00.000Z'))).toBe('2025041514');
	});
	it('zero-pads single-digit components', () => {
		expect(formatHourPath(new Date('2025-01-02T03:00:00.000Z'))).toBe('2025010203');
	});
});

describe('buildStorageKey', () => {
	it('composes couple/hour/user/attempt.ext', () => {
		const key = buildStorageKey({
			coupleId: 'cpl1',
			userId: 'usr1',
			hourBucket: new Date('2025-04-15T14:00:00.000Z'),
			attemptId: 'att1',
			mime: 'video/webm'
		});
		expect(key).toBe('cpl1/2025041514/usr1/att1.webm');
	});
	it('uses .mp4 for video/mp4', () => {
		const key = buildStorageKey({
			coupleId: 'cpl1',
			userId: 'usr1',
			hourBucket: new Date('2025-04-15T14:00:00.000Z'),
			attemptId: 'att1',
			mime: 'video/mp4'
		});
		expect(key.endsWith('.mp4')).toBe(true);
	});
});

describe('secondsUntilBoundary', () => {
	it('returns full hour when at the start of the bucket', () => {
		const bucket = new Date('2025-04-15T14:00:00.000Z');
		expect(secondsUntilBoundary(bucket, bucket)).toBe(3600);
	});
	it('returns the remaining seconds mid-hour', () => {
		const bucket = new Date('2025-04-15T14:00:00.000Z');
		const now = new Date('2025-04-15T14:30:00.000Z');
		expect(secondsUntilBoundary(now, bucket)).toBe(1800);
	});
	it('floors to at least 1 second past the boundary', () => {
		const bucket = new Date('2025-04-15T14:00:00.000Z');
		const now = new Date('2025-04-15T15:00:01.000Z');
		expect(secondsUntilBoundary(now, bucket)).toBe(1);
	});
});

describe('isHourlyMime / isHourlyMood', () => {
	it('accepts the exact allow-list and rejects others', () => {
		for (const m of HOURLY_ALLOWED_MIMES) expect(isHourlyMime(m)).toBe(true);
		expect(isHourlyMime('video/quicktime')).toBe(false);
		expect(isHourlyMime('image/png')).toBe(false);
		expect(isHourlyMime(undefined)).toBe(false);
		expect(isHourlyMime(null)).toBe(false);
		expect(isHourlyMime(42)).toBe(false);
	});

	it('accepts the 5-emoji mood enum and rejects others', () => {
		for (const m of HOURLY_MOODS) expect(isHourlyMood(m)).toBe(true);
		expect(isHourlyMood('angry')).toBe(false);
		expect(isHourlyMood('')).toBe(false);
		expect(isHourlyMood(undefined)).toBe(false);
	});
});
