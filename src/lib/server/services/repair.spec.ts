// Pure-surface tests for the F16 repair service. DB-touching paths
// are exercised in integration tests; here we only assert the
// constants and the typed-error contract that API handlers rely on.

import { describe, it, expect } from 'vitest';
import {
	REPAIR_NOTE_MAX_LEN,
	REPAIR_COOLDOWN_MIN_MS,
	REPAIR_COOLDOWN_MAX_MS,
	REPAIR_COOLDOWN_DEFAULT_MS,
	RepairValidationError
} from './repair';

describe('repair constants', () => {
	it('REPAIR_NOTE_MAX_LEN matches the SQL CHECK constraint', () => {
		expect(REPAIR_NOTE_MAX_LEN).toBe(1000);
	});
	it('cooldown bounds are sane', () => {
		expect(REPAIR_COOLDOWN_MIN_MS).toBe(5 * 60_000);
		expect(REPAIR_COOLDOWN_MAX_MS).toBe(24 * 60 * 60_000);
		expect(REPAIR_COOLDOWN_DEFAULT_MS).toBeGreaterThanOrEqual(REPAIR_COOLDOWN_MIN_MS);
		expect(REPAIR_COOLDOWN_DEFAULT_MS).toBeLessThanOrEqual(REPAIR_COOLDOWN_MAX_MS);
	});
});

describe('RepairValidationError', () => {
	it('preserves the error code for API discrimination', () => {
		const codes = [
			'note_too_long',
			'cooldown_out_of_range',
			'session_not_found',
			'not_a_member',
			'already_active',
			'still_cooling',
			'wrong_status'
		] as const;
		for (const code of codes) {
			const e = new RepairValidationError('msg', code);
			expect(e.code).toBe(code);
			expect(e.name).toBe('RepairValidationError');
			expect(e).toBeInstanceOf(Error);
		}
	});
});
