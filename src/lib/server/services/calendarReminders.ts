// DuoSync — F8 v2 calendar reminders service.
//
// `populateForEvent` is invoked whenever a calendar event is created
// or its schedule mutates. It derives the next REMINDER_HORIZON_DAYS
// of occurrences (single events get one occurrence at startsAt; rrule
// events expand via the same allow-listed engine the calendar uses)
// and inserts one row per (occurrence × kind) into calendar_reminders.
// Past-due occurrences are skipped — we don't fire late reminders.
//
// `clearForEvent` wipes pending rows; called before re-populating on
// update so a shifted DTSTART doesn't leave stale rows around. Sent
// rows are kept for telemetry. ON DELETE CASCADE on the FK handles
// the delete path automatically.
//
// `deliverDue` is the TS mirror of the SECURITY DEFINER pg function in
// 0018_calendar_reminders.sql — used by dev cron and as a future
// per-request top-up. Both write to push_outbox with the same dedupe
// key, so concurrent runs are safe.

import { and, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { calendarEvents, calendarReminders } from '$lib/server/db/app.schema';
import {
	MAX_REMINDERS_PER_POPULATE,
	REMINDER_HORIZON_MS,
	REMINDER_KINDS,
	REMINDER_OFFSET_MS,
	type ReminderKind
} from '$lib/calendarReminders.constants';
import { expandOccurrences } from './recurrence';

export { REMINDER_HORIZON_MS, REMINDER_KINDS, REMINDER_OFFSET_MS, MAX_REMINDERS_PER_POPULATE };
export type { ReminderKind };

export type ReminderRow = {
	eventId: string;
	occurrenceAt: Date;
	kind: ReminderKind;
	fireAt: Date;
};

/**
 * Pure: derive the (occurrence × kind) reminder rows for an event.
 *
 * Skips any (occurrence, kind) whose `fireAt` is already in the past
 * relative to `now` — late reminders are noise.
 *
 * For non-recurring events the only occurrence is `startsAt`. For
 * recurring events we expand inside `[now, now + horizon]`.
 *
 * Bounded by MAX_REMINDERS_PER_POPULATE; if a rule somehow produces
 * more rows the result is truncated (guard against pathological rules
 * the validator missed).
 */
export function deriveUpcomingReminders(input: {
	eventId: string;
	startsAt: Date;
	rrule: string | null;
	now?: Date;
	horizonMs?: number;
}): ReminderRow[] {
	const now = input.now ?? new Date();
	const horizonMs = input.horizonMs ?? REMINDER_HORIZON_MS;
	const to = new Date(now.getTime() + horizonMs);

	let occurrences: Date[];
	if (!input.rrule) {
		occurrences = input.startsAt > now && input.startsAt <= to ? [input.startsAt] : [];
	} else {
		occurrences = expandOccurrences({
			rrule: input.rrule,
			dtstart: input.startsAt,
			from: now,
			to
		});
	}

	const out: ReminderRow[] = [];
	for (const occurrenceAt of occurrences) {
		for (const kind of REMINDER_KINDS) {
			const fireAt = new Date(occurrenceAt.getTime() - REMINDER_OFFSET_MS[kind]);
			if (fireAt <= now) continue;
			out.push({ eventId: input.eventId, occurrenceAt, kind, fireAt });
			if (out.length >= MAX_REMINDERS_PER_POPULATE) return out;
		}
	}
	return out;
}

/**
 * Insert reminder rows for an event. ON CONFLICT DO NOTHING keeps the
 * call idempotent so re-population after a no-op update is safe.
 *
 * Returns the number of rows the planner derived (NOT the number
 * actually inserted — those may collide on existing rows). Callers
 * use it for telemetry only.
 */
export async function populateForEvent(input: {
	eventId: string;
	startsAt: Date;
	rrule: string | null;
	now?: Date;
}): Promise<number> {
	const rows = deriveUpcomingReminders(input);
	if (rows.length === 0) return 0;
	await db
		.insert(calendarReminders)
		.values(
			rows.map((r) => ({
				eventId: r.eventId,
				occurrenceAt: r.occurrenceAt,
				kind: r.kind,
				fireAt: r.fireAt
			}))
		)
		.onConflictDoNothing();
	return rows.length;
}

/**
 * Drop pending (sent_at IS NULL) reminders for an event. Sent rows
 * are kept for telemetry / "did we already remind them?" lookups.
 */
export async function clearPendingForEvent(eventId: string): Promise<number> {
	const result = await db
		.delete(calendarReminders)
		.where(and(eq(calendarReminders.eventId, eventId), isNull(calendarReminders.sentAt)))
		.returning({ kind: calendarReminders.kind });
	return result.length;
}

/**
 * Atomic claim due reminders + fan out a push_outbox row to BOTH
 * partners. Mirror of `app.deliver_due_calendar_reminders` in
 * 0018_calendar_reminders.sql. Returns the number of outbox rows
 * actually inserted (after ON CONFLICT collisions).
 */
export async function deliverDue(now: Date = new Date(), batchSize = 50): Promise<number> {
	void calendarEvents; // ensure schema-only import isn't tree-shaken
	const result = await db.execute(sql`
		with due as (
			update calendar_reminders r
			set sent_at = ${now.toISOString()}
			where (r.event_id, r.occurrence_at, r.kind) in (
				select event_id, occurrence_at, kind
				from calendar_reminders
				where sent_at is null and fire_at <= ${now.toISOString()}
				order by fire_at
				for update skip locked
				limit ${batchSize}
			)
			returning r.event_id, r.occurrence_at, r.kind
		),
		joined as (
			select
				due.event_id,
				due.occurrence_at,
				due.kind,
				e.couple_id,
				e.title,
				c.partner_a,
				c.partner_b
			from due
			join calendar_events e on e.id = due.event_id
			join couple c on c.id = e.couple_id
		),
		fanout as (
			select couple_id, partner_a as recipient_id, event_id, occurrence_at, kind, title
			from joined
			union all
			select couple_id, partner_b as recipient_id, event_id, occurrence_at, kind, title
			from joined
		)
		insert into push_outbox (couple_id, recipient_id, kind, title, body, data_json, dedupe_key)
		select
			f.couple_id,
			f.recipient_id,
			'calendar_reminder',
			f.title,
			case f.kind
				when 'h24' then 'Reminder: starts in 24 hours'
				when 'h1'  then 'Reminder: starts in 1 hour'
				else 'Calendar reminder'
			end,
			json_build_object(
				'eventId', f.event_id,
				'occurrenceAt', f.occurrence_at,
				'kind', f.kind
			)::text,
			'cal_reminder:' || f.event_id || ':' || extract(epoch from f.occurrence_at)::bigint || ':' || f.kind
		from fanout f
		on conflict (recipient_id, dedupe_key) do nothing
		returning recipient_id;
	`);

	const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows) ?? [];
	return rows.length;
}
