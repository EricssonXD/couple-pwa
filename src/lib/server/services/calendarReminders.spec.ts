import { describe, it, expect } from 'vitest';
import {
	deriveUpcomingReminders,
	REMINDER_OFFSET_MS,
	REMINDER_KINDS,
	REMINDER_HORIZON_MS,
	MAX_REMINDERS_PER_POPULATE
} from './calendarReminders';

const NOW = new Date('2025-01-01T00:00:00Z');

describe('deriveUpcomingReminders — single occurrence', () => {
	it('emits both kinds when event is far enough in the future', () => {
		const startsAt = new Date(NOW.getTime() + 48 * 3600_000);
		const rows = deriveUpcomingReminders({
			eventId: 'e1',
			startsAt,
			rrule: null,
			now: NOW
		});
		expect(rows).toHaveLength(2);
		const kinds = rows.map((r) => r.kind).sort();
		expect(kinds).toEqual(['h1', 'h24']);
		for (const r of rows) {
			expect(r.fireAt.getTime()).toBe(startsAt.getTime() - REMINDER_OFFSET_MS[r.kind]);
		}
	});

	it('emits only h1 when event is between 1h and 24h away', () => {
		const startsAt = new Date(NOW.getTime() + 2 * 3600_000);
		const rows = deriveUpcomingReminders({
			eventId: 'e1',
			startsAt,
			rrule: null,
			now: NOW
		});
		expect(rows).toHaveLength(1);
		expect(rows[0].kind).toBe('h1');
	});

	it('emits nothing when event is less than 1h away', () => {
		const startsAt = new Date(NOW.getTime() + 30 * 60_000);
		const rows = deriveUpcomingReminders({
			eventId: 'e1',
			startsAt,
			rrule: null,
			now: NOW
		});
		expect(rows).toHaveLength(0);
	});

	it('emits nothing for past events', () => {
		const startsAt = new Date(NOW.getTime() - 86_400_000);
		const rows = deriveUpcomingReminders({
			eventId: 'e1',
			startsAt,
			rrule: null,
			now: NOW
		});
		expect(rows).toHaveLength(0);
	});

	it('emits nothing when event is past the horizon', () => {
		const startsAt = new Date(NOW.getTime() + REMINDER_HORIZON_MS + 86_400_000);
		const rows = deriveUpcomingReminders({
			eventId: 'e1',
			startsAt,
			rrule: null,
			now: NOW
		});
		expect(rows).toHaveLength(0);
	});
});

describe('deriveUpcomingReminders — recurring', () => {
	it('expands FREQ=WEEKLY;COUNT=4 starting in ~25h into reminders for each occurrence', () => {
		const startsAt = new Date(NOW.getTime() + 25 * 3600_000);
		const rows = deriveUpcomingReminders({
			eventId: 'e1',
			startsAt,
			rrule: 'FREQ=WEEKLY;COUNT=4',
			now: NOW
		});
		// 4 occurrences * 2 kinds = 8 (first occurrence is >24h out so h24 is in the future)
		expect(rows).toHaveLength(8);
		const h1Rows = rows.filter((r) => r.kind === 'h1');
		expect(h1Rows).toHaveLength(4);
	});

	it('respects horizon — DAILY rule with COUNT=400 truncates', () => {
		const startsAt = new Date(NOW.getTime() + 3600_000 + 60_000);
		const rows = deriveUpcomingReminders({
			eventId: 'e1',
			startsAt,
			rrule: 'FREQ=DAILY;COUNT=400',
			now: NOW
		});
		// horizon clamps to ~30 occurrences * 2 kinds = ~60, well under cap
		expect(rows.length).toBeLessThanOrEqual(MAX_REMINDERS_PER_POPULATE);
		expect(rows.length).toBeLessThanOrEqual(31 * 2);
	});

	it('emits no reminders for a past-only recurrence', () => {
		const startsAt = new Date(NOW.getTime() - 30 * 86_400_000);
		const rows = deriveUpcomingReminders({
			eventId: 'e1',
			startsAt,
			rrule: 'FREQ=WEEKLY;COUNT=2',
			now: NOW
		});
		expect(rows).toHaveLength(0);
	});
});

describe('constants', () => {
	it('REMINDER_KINDS lists exactly h24 and h1', () => {
		expect([...REMINDER_KINDS].sort()).toEqual(['h1', 'h24']);
	});

	it('offsets match canonical wall-clock leads', () => {
		expect(REMINDER_OFFSET_MS.h24).toBe(86_400_000);
		expect(REMINDER_OFFSET_MS.h1).toBe(3_600_000);
	});
});
