// Pure unit tests for the recurrence helper (rrule.js wrapper).

import { describe, it, expect } from 'vitest';
import {
	normalizeRrule,
	expandOccurrences,
	RruleValidationError,
	MAX_OCCURRENCES_PER_EXPAND,
	MAX_RRULE_LEN
} from './recurrence';

describe('normalizeRrule', () => {
	it('accepts a minimal weekly rule', () => {
		expect(normalizeRrule('FREQ=WEEKLY')).toBe('FREQ=WEEKLY');
	});

	it('strips a leading RRULE: prefix', () => {
		expect(normalizeRrule('RRULE:FREQ=DAILY;INTERVAL=2')).toBe('FREQ=DAILY;INTERVAL=2');
	});

	it('upper-cases the rule body', () => {
		expect(normalizeRrule('freq=monthly;bymonthday=15')).toBe('FREQ=MONTHLY;BYMONTHDAY=15');
	});

	it('rejects missing FREQ', () => {
		expect(() => normalizeRrule('INTERVAL=1')).toThrowError(RruleValidationError);
	});

	it('rejects unsupported FREQ', () => {
		expect(() => normalizeRrule('FREQ=SECONDLY')).toThrowError(/FREQ=SECONDLY/);
	});

	it('rejects unknown parts', () => {
		expect(() => normalizeRrule('FREQ=DAILY;BYHOUR=9')).toThrowError(/BYHOUR/);
	});

	it('rejects repeated parts', () => {
		expect(() => normalizeRrule('FREQ=DAILY;FREQ=WEEKLY')).toThrowError(/repeats/);
	});

	it('rejects malformed parts', () => {
		expect(() => normalizeRrule('FREQDAILY')).toThrowError(RruleValidationError);
	});

	it('rejects rules longer than the cap', () => {
		const long = 'FREQ=DAILY;BYDAY=' + 'MO,'.repeat(MAX_RRULE_LEN);
		expect(() => normalizeRrule(long)).toThrowError(/exceeds/);
	});

	it('rejects empty / non-string input', () => {
		expect(() => normalizeRrule('')).toThrowError(RruleValidationError);
		expect(() => normalizeRrule(123)).toThrowError(RruleValidationError);
		expect(() => normalizeRrule(null)).toThrowError(RruleValidationError);
		expect(() => normalizeRrule(undefined)).toThrowError(RruleValidationError);
	});
});

describe('expandOccurrences', () => {
	it('returns one occurrence per day for a daily rule', () => {
		const dtstart = new Date('2025-01-01T09:00:00Z');
		const out = expandOccurrences({
			rrule: 'FREQ=DAILY',
			dtstart,
			from: new Date('2025-01-01T00:00:00Z'),
			to: new Date('2025-01-05T23:59:59Z')
		});
		expect(out).toHaveLength(5);
		expect(out[0].toISOString()).toBe('2025-01-01T09:00:00.000Z');
		expect(out[4].toISOString()).toBe('2025-01-05T09:00:00.000Z');
	});

	it('respects COUNT', () => {
		const dtstart = new Date('2025-01-01T09:00:00Z');
		const out = expandOccurrences({
			rrule: 'FREQ=DAILY;COUNT=3',
			dtstart,
			from: new Date('2025-01-01T00:00:00Z'),
			to: new Date('2025-12-31T00:00:00Z')
		});
		expect(out).toHaveLength(3);
	});

	it('respects UNTIL', () => {
		const dtstart = new Date('2025-01-01T09:00:00Z');
		const out = expandOccurrences({
			rrule: 'FREQ=WEEKLY;UNTIL=20250115T000000Z',
			dtstart,
			from: new Date('2025-01-01T00:00:00Z'),
			to: new Date('2025-12-31T00:00:00Z')
		});
		// 2025-01-01 (Wed) + 2025-01-08 (Wed) — 2025-01-15 is exactly UNTIL midnight UTC,
		// which precedes the 09:00 occurrence on that date.
		expect(out).toHaveLength(2);
	});

	it('caps at MAX_OCCURRENCES_PER_EXPAND', () => {
		const dtstart = new Date('2025-01-01T09:00:00Z');
		const out = expandOccurrences({
			rrule: 'FREQ=DAILY',
			dtstart,
			from: new Date('2025-01-01T00:00:00Z'),
			to: new Date('2030-01-01T00:00:00Z')
		});
		expect(out.length).toBeLessThanOrEqual(MAX_OCCURRENCES_PER_EXPAND);
	});

	it('honours an explicit limit smaller than the global cap', () => {
		const dtstart = new Date('2025-01-01T09:00:00Z');
		const out = expandOccurrences({
			rrule: 'FREQ=DAILY',
			dtstart,
			from: new Date('2025-01-01T00:00:00Z'),
			to: new Date('2025-12-31T00:00:00Z'),
			limit: 7
		});
		expect(out).toHaveLength(7);
	});

	it('falls back to a single occurrence on a corrupt rule', () => {
		const dtstart = new Date('2025-06-15T12:00:00Z');
		const out = expandOccurrences({
			rrule: 'FREQ=BANANA',
			dtstart,
			from: new Date('2025-06-01T00:00:00Z'),
			to: new Date('2025-06-30T00:00:00Z')
		});
		expect(out).toEqual([dtstart]);
	});

	it('returns empty when the window precedes DTSTART', () => {
		const dtstart = new Date('2030-01-01T09:00:00Z');
		const out = expandOccurrences({
			rrule: 'FREQ=DAILY',
			dtstart,
			from: new Date('2020-01-01T00:00:00Z'),
			to: new Date('2020-12-31T00:00:00Z')
		});
		expect(out).toEqual([]);
	});
});
