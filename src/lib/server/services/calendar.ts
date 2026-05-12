// DuoSync — F8 Shared calendar service (v1).
//
// CRUD over couple-shared events. v1 returns only single occurrences;
// the `rrule` column is reserved for v2 recurrence expansion.
//
// Service-role Drizzle bypasses RLS, so API handlers MUST derive
// coupleId from `locals.couple`, never from the request body.

import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { calendarEvents } from '$lib/server/db/app.schema';
import { MAX_TITLE_LEN, MAX_NOTES_LEN, MAX_EVENTS_PER_COUPLE } from '$lib/calendar.constants';

export { MAX_TITLE_LEN, MAX_NOTES_LEN, MAX_EVENTS_PER_COUPLE };

export type CalendarEvent = {
	id: string;
	title: string;
	notes: string | null;
	startsAt: Date;
	endsAt: Date | null;
	allDay: boolean;
	rrule: string | null;
	createdBy: string;
	createdAt: Date;
	updatedAt: Date;
};

export class CalendarEventValidationError extends Error {
	constructor(
		message: string,
		readonly code:
			| 'title_empty'
			| 'title_too_long'
			| 'notes_too_long'
			| 'invalid_starts_at'
			| 'invalid_ends_at'
			| 'ends_before_starts'
			| 'quota_exceeded'
	) {
		super(message);
		this.name = 'CalendarEventValidationError';
	}
}

function normalizeTitle(raw: unknown): string {
	if (typeof raw !== 'string') {
		throw new CalendarEventValidationError('title is required', 'title_empty');
	}
	const t = raw.trim();
	if (t.length === 0) throw new CalendarEventValidationError('title is required', 'title_empty');
	if (t.length > MAX_TITLE_LEN)
		throw new CalendarEventValidationError(
			`title exceeds ${MAX_TITLE_LEN} chars`,
			'title_too_long'
		);
	return t;
}

function normalizeNotes(raw: unknown): string | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== 'string') return null;
	const n = raw.trim();
	if (n.length === 0) return null;
	if (n.length > MAX_NOTES_LEN)
		throw new CalendarEventValidationError(
			`notes exceeds ${MAX_NOTES_LEN} chars`,
			'notes_too_long'
		);
	return n;
}

function normalizeDate(raw: unknown, code: 'invalid_starts_at' | 'invalid_ends_at'): Date {
	if (typeof raw !== 'string') {
		throw new CalendarEventValidationError(`${code} must be ISO 8601`, code);
	}
	const d = new Date(raw);
	if (Number.isNaN(d.getTime())) {
		throw new CalendarEventValidationError(`${code} is not a valid date`, code);
	}
	return d;
}

function rowToEvent(r: typeof calendarEvents.$inferSelect): CalendarEvent {
	return {
		id: r.id,
		title: r.title,
		notes: r.notes,
		startsAt: r.startsAt,
		endsAt: r.endsAt,
		allDay: r.allDay,
		rrule: r.rrule,
		createdBy: r.createdBy,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt
	};
}

/**
 * v1: returns single-occurrence events only. v2 will expand `rrule`
 * into virtual rows within [from, to].
 */
export async function listForCouple(input: {
	coupleId: string;
	from: Date;
	to: Date;
}): Promise<CalendarEvent[]> {
	const rows = await db
		.select()
		.from(calendarEvents)
		.where(
			and(
				eq(calendarEvents.coupleId, input.coupleId),
				gte(calendarEvents.startsAt, input.from),
				lte(calendarEvents.startsAt, input.to)
			)
		)
		.orderBy(asc(calendarEvents.startsAt));
	return rows.map(rowToEvent);
}

export async function createEvent(input: {
	coupleId: string;
	createdBy: string;
	title: unknown;
	notes?: unknown;
	startsAt: unknown;
	endsAt?: unknown;
	allDay?: unknown;
}): Promise<CalendarEvent> {
	const title = normalizeTitle(input.title);
	const notes = normalizeNotes(input.notes);
	const startsAt = normalizeDate(input.startsAt, 'invalid_starts_at');
	const endsAt =
		input.endsAt === undefined || input.endsAt === null
			? null
			: normalizeDate(input.endsAt, 'invalid_ends_at');
	if (endsAt && endsAt < startsAt) {
		throw new CalendarEventValidationError('endsAt is before startsAt', 'ends_before_starts');
	}
	const allDay = input.allDay === true;

	const [{ count }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(calendarEvents)
		.where(eq(calendarEvents.coupleId, input.coupleId));
	if (count >= MAX_EVENTS_PER_COUPLE) {
		throw new CalendarEventValidationError(
			`Couple has reached the ${MAX_EVENTS_PER_COUPLE}-event cap`,
			'quota_exceeded'
		);
	}

	const [row] = await db
		.insert(calendarEvents)
		.values({
			coupleId: input.coupleId,
			createdBy: input.createdBy,
			title,
			notes,
			startsAt,
			endsAt,
			allDay
		})
		.returning();
	return rowToEvent(row);
}

export async function updateEvent(input: {
	id: string;
	coupleId: string;
	title?: unknown;
	notes?: unknown;
	startsAt?: unknown;
	endsAt?: unknown;
	allDay?: unknown;
}): Promise<boolean> {
	const patch: Record<string, unknown> = {};
	if (input.title !== undefined) patch.title = normalizeTitle(input.title);
	if (input.notes !== undefined) patch.notes = normalizeNotes(input.notes);
	if (input.startsAt !== undefined)
		patch.startsAt = normalizeDate(input.startsAt, 'invalid_starts_at');
	if (input.endsAt !== undefined) {
		patch.endsAt = input.endsAt === null ? null : normalizeDate(input.endsAt, 'invalid_ends_at');
	}
	if (input.allDay !== undefined) patch.allDay = input.allDay === true;
	if (
		patch.startsAt instanceof Date &&
		patch.endsAt instanceof Date &&
		(patch.endsAt as Date) < (patch.startsAt as Date)
	) {
		throw new CalendarEventValidationError('endsAt is before startsAt', 'ends_before_starts');
	}
	if (Object.keys(patch).length === 0) return false;

	const result = await db
		.update(calendarEvents)
		.set(patch)
		.where(and(eq(calendarEvents.id, input.id), eq(calendarEvents.coupleId, input.coupleId)))
		.returning({ id: calendarEvents.id });
	return result.length > 0;
}

export async function deleteEvent(input: { id: string; coupleId: string }): Promise<boolean> {
	const result = await db
		.delete(calendarEvents)
		.where(and(eq(calendarEvents.id, input.id), eq(calendarEvents.coupleId, input.coupleId)))
		.returning({ id: calendarEvents.id });
	return result.length > 0;
}
