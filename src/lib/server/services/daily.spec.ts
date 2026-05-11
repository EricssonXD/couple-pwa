// DuoSync — Daily service: pure-helper coverage.
//
// Avoids touching Drizzle / postgres-js by testing only the deterministic
// pieces of the prompt-picker contract. The DB-backed paths are exercised
// indirectly via /daily route tests + manual QA.

import { describe, it, expect } from 'vitest';
import { hash32, todayKey, DailyError } from './daily';

describe('daily service — pure helpers', () => {
	describe('todayKey', () => {
		it('returns ISO YYYY-MM-DD for the given date', () => {
			expect(todayKey(new Date('2025-01-15T12:34:56Z'))).toBe('2025-01-15');
		});

		it('uses UTC, not local time (boundary)', () => {
			// 23:30 UTC → still 2025-01-15 even if local zone is UTC+something
			expect(todayKey(new Date('2025-01-15T23:30:00Z'))).toBe('2025-01-15');
			// 00:30 UTC → 2025-01-16
			expect(todayKey(new Date('2025-01-16T00:30:00Z'))).toBe('2025-01-16');
		});
	});

	describe('hash32 (FNV-1a)', () => {
		it('is deterministic for the same input', () => {
			const a = hash32('couple-abc|2025-01-15');
			const b = hash32('couple-abc|2025-01-15');
			expect(a).toBe(b);
		});

		it('returns an unsigned 32-bit integer', () => {
			const h = hash32('any-input-string');
			expect(Number.isInteger(h)).toBe(true);
			expect(h).toBeGreaterThanOrEqual(0);
			expect(h).toBeLessThanOrEqual(0xffffffff);
		});

		it('produces different values for different inputs', () => {
			expect(hash32('couple-a|2025-01-15')).not.toBe(hash32('couple-a|2025-01-16'));
			expect(hash32('couple-a|2025-01-15')).not.toBe(hash32('couple-b|2025-01-15'));
		});

		it('distributes across a small modulus reasonably (no all-zero pathology)', () => {
			// Sanity: 100 distinct inputs should yield at least 5 distinct buckets in mod-10.
			const buckets = new Set<number>();
			for (let i = 0; i < 100; i++) buckets.add(hash32(`couple-${i}|2025-01-15`) % 10);
			expect(buckets.size).toBeGreaterThanOrEqual(5);
		});

		it('same couple gets same prompt index across calls within a day', () => {
			const N = 32; // pretend we have 32 active questions
			const day = '2025-02-14';
			const couple = 'couple-xyz';
			const idx1 = hash32(couple + '|' + day) % N;
			const idx2 = hash32(couple + '|' + day) % N;
			expect(idx1).toBe(idx2);
		});

		it('couple gets a different prompt the next day (with high probability)', () => {
			// Not strictly guaranteed for every (N, couple), but with N=32 a 1-day
			// shift for a typical input should land on a different bucket. We assert
			// across several couples to make the test resilient.
			const N = 32;
			let differentCount = 0;
			for (let i = 0; i < 20; i++) {
				const couple = `couple-${i}`;
				const a = hash32(couple + '|2025-01-15') % N;
				const b = hash32(couple + '|2025-01-16') % N;
				if (a !== b) differentCount++;
			}
			// Expect at least 80% of couples to roll over to a new prompt.
			expect(differentCount).toBeGreaterThanOrEqual(16);
		});
	});

	describe('DailyError', () => {
		it('carries a stable code field', () => {
			const e = new DailyError('already_answered');
			expect(e).toBeInstanceOf(Error);
			expect(e.code).toBe('already_answered');
			expect(e.name).toBe('DailyError');
		});

		it('uses the code as the default message', () => {
			expect(new DailyError('no_couple').message).toBe('no_couple');
		});

		it('accepts a custom message override', () => {
			expect(new DailyError('invalid_body', 'too long').message).toBe('too long');
		});
	});
});
