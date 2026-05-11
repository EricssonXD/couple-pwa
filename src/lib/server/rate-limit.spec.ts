import { describe, it, expect, beforeEach } from 'vitest';
import { consume, _resetForTest } from './rate-limit';

describe('rate-limit token bucket', () => {
	beforeEach(() => _resetForTest());

	it('lets the first request through', () => {
		const r = consume('moments-write', 'user-a');
		expect(r.allowed).toBe(true);
		expect(r.remaining).toBe(29);
		expect(r.retryAfterMs).toBe(0);
	});

	it('throttles after the bucket is empty', () => {
		const t = 1_700_000_000_000;
		for (let i = 0; i < 30; i++) consume('moments-write', 'user-b', t);
		const r = consume('moments-write', 'user-b', t);
		expect(r.allowed).toBe(false);
		expect(r.remaining).toBe(0);
		expect(r.retryAfterMs).toBeGreaterThan(0);
	});

	it('refills tokens over time', () => {
		const t0 = 1_700_000_000_000;
		for (let i = 0; i < 30; i++) consume('moments-write', 'user-c', t0);
		expect(consume('moments-write', 'user-c', t0).allowed).toBe(false);
		// 30/min == 0.5 tokens/sec → after 4s we have 2 tokens.
		const r = consume('moments-write', 'user-c', t0 + 4_000);
		expect(r.allowed).toBe(true);
		expect(r.remaining).toBe(1);
	});

	it('isolates buckets per user', () => {
		const t = 1_700_000_000_000;
		for (let i = 0; i < 30; i++) consume('moments-write', 'user-d', t);
		const other = consume('moments-write', 'user-e', t);
		expect(other.allowed).toBe(true);
	});

	it('isolates buckets per bucket name', () => {
		const t = 1_700_000_000_000;
		for (let i = 0; i < 30; i++) consume('moments-write', 'user-f', t);
		expect(consume('moments-write', 'user-f', t).allowed).toBe(false);
		expect(consume('profile-write', 'user-f', t).allowed).toBe(true);
	});

	it('caps refill at capacity (no infinite credit for idle users)', () => {
		const t0 = 1_700_000_000_000;
		consume('profile-write', 'user-g', t0);
		// Idle for an hour; remaining should still cap at capacity-1.
		const r = consume('profile-write', 'user-g', t0 + 3_600_000);
		expect(r.allowed).toBe(true);
		expect(r.remaining).toBe(19);
	});
});
