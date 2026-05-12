// Pure-surface tests for the scheduledNotes service. The DB-touching
// paths (scheduleNote, cancelNote, listX, deliverDue) are exercised
// in integration via psql + Playwright; here we only assert the
// validation invariants and exported constants.

import { describe, it, expect } from 'vitest';
import {
	MIN_LEAD_TIME_MS,
	MAX_LEAD_TIME_MS,
	MAX_BODY_LEN,
	MAX_PENDING_PER_AUTHOR,
	ScheduledNoteValidationError
} from './scheduledNotes';

describe('scheduledNotes constants', () => {
	it('MIN_LEAD_TIME_MS is 5 minutes', () => {
		expect(MIN_LEAD_TIME_MS).toBe(5 * 60_000);
	});

	it('MAX_LEAD_TIME_MS is 10 years', () => {
		expect(MAX_LEAD_TIME_MS).toBe(10 * 365 * 86_400_000);
	});

	it('MAX_BODY_LEN matches the SQL CHECK constraint', () => {
		expect(MAX_BODY_LEN).toBe(2000);
	});

	it('MAX_PENDING_PER_AUTHOR caps the per-author backlog', () => {
		expect(MAX_PENDING_PER_AUTHOR).toBe(100);
	});
});

describe('ScheduledNoteValidationError', () => {
	it('preserves the error code for clients to discriminate on', () => {
		const e = new ScheduledNoteValidationError('x', 'too_soon');
		expect(e.code).toBe('too_soon');
		expect(e.name).toBe('ScheduledNoteValidationError');
		expect(e instanceof Error).toBe(true);
	});

	it('codes cover every validation failure mode', () => {
		const codes: ScheduledNoteValidationError['code'][] = [
			'too_soon',
			'too_far',
			'body_empty',
			'body_too_long',
			'quota_exceeded'
		];
		for (const c of codes) {
			expect(new ScheduledNoteValidationError('x', c).code).toBe(c);
		}
	});
});
