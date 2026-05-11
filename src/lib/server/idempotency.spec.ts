import { describe, it, expect, beforeEach } from 'vitest';
import {
	lookupIdempotent,
	storeIdempotent,
	readIdempotencyKey,
	_resetForTest
} from './idempotency';

describe('server idempotency cache', () => {
	beforeEach(() => _resetForTest());

	it('returns null on miss', () => {
		expect(lookupIdempotent('user-1', 'k1')).toBeNull();
	});

	it('round-trips a stored response', () => {
		storeIdempotent('user-1', 'k1', 200, { ok: true, id: 'abc' });
		const got = lookupIdempotent('user-1', 'k1');
		expect(got).not.toBeNull();
		expect(got!.status).toBe(200);
		expect(JSON.parse(got!.body)).toEqual({ ok: true, id: 'abc' });
	});

	it('scopes by userId — same key, different users do not collide', () => {
		storeIdempotent('user-1', 'shared', 200, { from: 'user-1' });
		storeIdempotent('user-2', 'shared', 200, { from: 'user-2' });
		expect(JSON.parse(lookupIdempotent('user-1', 'shared')!.body)).toEqual({ from: 'user-1' });
		expect(JSON.parse(lookupIdempotent('user-2', 'shared')!.body)).toEqual({ from: 'user-2' });
	});

	it('readIdempotencyKey trims and rejects garbage', () => {
		const ok = new Headers({ 'x-idempotency-key': '  valid-key-1  ' });
		expect(readIdempotencyKey(ok)).toBe('valid-key-1');

		const empty = new Headers({ 'x-idempotency-key': '   ' });
		expect(readIdempotencyKey(empty)).toBeNull();

		const tooLong = new Headers({ 'x-idempotency-key': 'x'.repeat(500) });
		expect(readIdempotencyKey(tooLong)).toBeNull();

		expect(readIdempotencyKey(new Headers())).toBeNull();
	});

	it('preserves status code on replay', () => {
		storeIdempotent('user-1', 'k', 201, { created: true });
		expect(lookupIdempotent('user-1', 'k')!.status).toBe(201);
	});
});
