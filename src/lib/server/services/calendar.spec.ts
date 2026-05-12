// Pure-surface tests for the calendar service. DB-touching paths
// are exercised in integration tests; here we assert validation
// invariants and exported constants only.

import { describe, it, expect } from 'vitest';
import {
	MAX_TITLE_LEN,
	MAX_NOTES_LEN,
	MAX_EVENTS_PER_COUPLE,
	CalendarEventValidationError
} from './calendar';

describe('calendar constants', () => {
	it('MAX_TITLE_LEN matches the SQL CHECK constraint', () => {
		expect(MAX_TITLE_LEN).toBe(200);
	});
	it('MAX_NOTES_LEN matches the SQL CHECK constraint', () => {
		expect(MAX_NOTES_LEN).toBe(2000);
	});
	it('MAX_EVENTS_PER_COUPLE caps the couple backlog', () => {
		expect(MAX_EVENTS_PER_COUPLE).toBe(2000);
	});
});

describe('CalendarEventValidationError', () => {
	it('preserves the error code', () => {
		const e = new CalendarEventValidationError('x', 'title_empty');
		expect(e.code).toBe('title_empty');
		expect(e.name).toBe('CalendarEventValidationError');
	});

	it('supports all documented codes', () => {
		const codes: CalendarEventValidationError['code'][] = [
			'title_empty',
			'title_too_long',
			'notes_too_long',
			'invalid_starts_at',
			'invalid_ends_at',
			'ends_before_starts',
			'quota_exceeded',
			'invalid_rrule'
		];
		for (const c of codes) {
			expect(new CalendarEventValidationError('x', c).code).toBe(c);
		}
	});
});
