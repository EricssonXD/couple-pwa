// DuoSync — F8 Shared calendar service.
//
// CRUD over couple-shared events. v2 supports recurrence: the `rrule`
// column stores a normalised RFC 5545 fragment, validated server-side
// via `services/recurrence.ts`. `listForCouple` expands recurring
// events into virtual occurrences within the requested window.
//
// Service-role Drizzle bypasses RLS, so API handlers MUST derive
// coupleId from `locals.couple`, never from the request body.

import { and, asc, eq, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { calendarEvents } from '$lib/server/db/app.schema';
import { MAX_TITLE_LEN, MAX_NOTES_LEN, MAX_EVENTS_PER_COUPLE } from '$lib/calendar.constants';
import { expandOccurrences, normalizeRrule, RruleValidationError } from './recurrence';
import { clearPendingForEvent, populateForEvent } from './calendarReminders';

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

/**
 * A virtual single instant of a (possibly recurring) calendar event.
 * `occurrenceAt` is the resolved start instant; `startsAt` remains the
 * stored DTSTART so the UI can derive duration via `endsAt - startsAt`.
 */
export type CalendarEventOccurrence = CalendarEvent & {
	occurrenceAt: Date;
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
			| 'invalid_rrule'
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

function normalizeOptionalRrule(raw: unknown): string | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw === 'string' && raw.trim().length === 0) return null;
	try {
		return normalizeRrule(raw);
	} catch (err) {
		if (err instanceof RruleValidationError) {
			throw new CalendarEventValidationError(`invalid rrule: ${err.code}`, 'invalid_rrule');
		}
		throw err;
	}
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
 * Returns all event occurrences inside `[from, to]`. Single-occurrence
 * events whose `startsAt` falls in-window are returned directly.
 * Recurring events (rrule != null) are expanded into virtual
 * `CalendarEventOccurrence` rows — one per concrete instant — sharing
 * the parent event's id. Caller can disambiguate via `occurrenceAt`.
 *
 * The DB filter loads:
 *   - non-recurring rows whose startsAt ≤ to (we still bound by from
 *     post-expansion so a long-tailed event isn't dropped)
 *   - all recurring rows whose DTSTART (startsAt) ≤ to (the rule may
 *     still produce occurrences after now even if it started years ago)
 *
 * To keep the worker bounded we cap recurring expansion per-event in
 * `services/recurrence.ts` (MAX_OCCURRENCES_PER_EXPAND).
 */
export async function listForCouple(input: {
	coupleId: string;
	from: Date;
	to: Date;
}): Promise<CalendarEventOccurrence[]> {
	const rows = await db
		.select()
		.from(calendarEvents)
		.where(
			and(
				eq(calendarEvents.coupleId, input.coupleId),
				lte(calendarEvents.startsAt, input.to),
				or(isNotNull(calendarEvents.rrule), isNull(calendarEvents.rrule))
			)
		)
		.orderBy(asc(calendarEvents.startsAt));

	const out: CalendarEventOccurrence[] = [];
	for (const r of rows) {
		const event = rowToEvent(r);
		if (!event.rrule) {
			if (event.startsAt >= input.from && event.startsAt <= input.to) {
				out.push({ ...event, occurrenceAt: event.startsAt });
			}
			continue;
		}
		const instants = expandOccurrences({
			rrule: event.rrule,
			dtstart: event.startsAt,
			from: input.from,
			to: input.to
		});
		for (const occurrenceAt of instants) {
			out.push({ ...event, occurrenceAt });
		}
	}
	out.sort((a, b) => a.occurrenceAt.getTime() - b.occurrenceAt.getTime());
	return out;
}

export async function createEvent(input: {
	coupleId: string;
	createdBy: string;
	title: unknown;
	notes?: unknown;
	startsAt: unknown;
	endsAt?: unknown;
	allDay?: unknown;
	rrule?: unknown;
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
	const rrule = normalizeOptionalRrule(input.rrule);

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
			allDay,
			rrule
		})
		.returning();
	const event = rowToEvent(row);
	// Reminder rows are derived from startsAt/rrule. Failure here must
	// not roll back the event itself (the cron will keep working off
	// whatever rows we did manage to insert), so we log and move on.
	try {
		await populateForEvent({
			eventId: event.id,
			startsAt: event.startsAt,
			rrule: event.rrule
		});
	} catch (err) {
		console.error('[calendar] populateForEvent failed', { eventId: event.id, err });
	}
	return event;
}

export async function updateEvent(input: {
	id: string;
	coupleId: string;
	title?: unknown;
	notes?: unknown;
	startsAt?: unknown;
	endsAt?: unknown;
	allDay?: unknown;
	rrule?: unknown;
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
	if (input.rrule !== undefined) patch.rrule = normalizeOptionalRrule(input.rrule);
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
		.returning();
	if (result.length === 0) return false;

	// Re-derive reminders only when the schedule (or recurrence) shifted.
	// Other field edits (title, notes, allDay) leave the existing rows
	// alone — the cron joins back to calendar_events for the title at
	// fire time, so retitles propagate naturally.
	const scheduleChanged = patch.startsAt !== undefined || patch.rrule !== undefined;
	if (scheduleChanged) {
		const updated = rowToEvent(result[0]);
		try {
			await clearPendingForEvent(updated.id);
			await populateForEvent({
				eventId: updated.id,
				startsAt: updated.startsAt,
				rrule: updated.rrule
			});
		} catch (err) {
			console.error('[calendar] reminder re-population failed', {
				eventId: updated.id,
				err
			});
		}
	}
	return true;
}

export async function deleteEvent(input: { id: string; coupleId: string }): Promise<boolean> {
	const result = await db
		.delete(calendarEvents)
		.where(and(eq(calendarEvents.id, input.id), eq(calendarEvents.coupleId, input.coupleId)))
		.returning({ id: calendarEvents.id });
	return result.length > 0;
}
