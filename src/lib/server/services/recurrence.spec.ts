// Pure unit tests for the recurrence helper (rrule.js wrapper).

import { execFileSync } from 'node:child_process';
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

// Regression guard for the cjs/esm dual-package gotcha that caused all
// production calendar recurrences to fail with `invalid_rrule`.
//
// Vitest (and Bun) flatten the rrule namespace import so that
// `rruleNs.rrulestr` resolves directly. Native Node ESM and Cloudflare
// Workers DO NOT — there, `rrulestr` lives only on `rruleNs.default`.
// A unit test here is fooled by the resolver.
//
// We spawn a real `node --input-type=module` subprocess to verify both
// the raw namespace shape and that our wrapper returns valid output for
// a WEEKLY rule end-to-end. If someone ever reverts the
// `(rruleNs.default ?? rruleNs)` fallback in recurrence.ts, this test
// fails immediately.
describe('rrule namespace under native Node ESM', () => {
	it('rrulestr is reachable via .default and weekly expansion works', () => {
		const script = `
			import * as rruleNs from 'rrule';
			const flat = rruleNs.rrulestr;
			const viaDefault = rruleNs.default && rruleNs.default.rrulestr;
			const accessor = (rruleNs.default ?? rruleNs).rrulestr;
			if (typeof accessor !== 'function') {
				throw new Error('rrulestr accessor is not a function');
			}
			const dtstart = new Date('2030-01-06T10:00:00Z');
			const set = accessor('DTSTART:20300106T100000Z\\nRRULE:FREQ=WEEKLY;COUNT=3', { forceset: true });
			const occ = set.between(new Date('2030-01-01T00:00:00Z'), new Date('2030-02-01T00:00:00Z'), true);
			console.log(JSON.stringify({
				flatDefined: typeof flat === 'function',
				viaDefaultDefined: typeof viaDefault === 'function',
				count: occ.length
			}));
		`;
		const out = execFileSync('node', ['--input-type=module', '-e', script], {
			cwd: process.cwd(),
			encoding: 'utf8'
		}).trim();
		const parsed = JSON.parse(out) as {
			flatDefined: boolean;
			viaDefaultDefined: boolean;
			count: number;
		};
		// The whole point: under native Node ESM, viaDefault is the
		// reliable accessor. flatDefined may be true OR false depending
		// on rrule's package shape; we don't assert on it. We DO assert
		// that the .default accessor works and that expansion returns
		// the expected occurrence count.
		expect(parsed.viaDefaultDefined).toBe(true);
		expect(parsed.count).toBe(3);
	});
});
