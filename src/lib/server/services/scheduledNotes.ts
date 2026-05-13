// DuoSync — F3 Scheduled-notes service ("time capsule").
//
// Author writes a private note, picks a future deliverAt; the cron
// worker pings the SvelteKit Worker every 15 minutes which calls
// `deliverDue` to atomically claim due rows and enqueue partner pushes.
//
// Per RLS on scheduled_notes (drizzle/manual/0013), the partner cannot
// see a pending note's existence until delivery — anti-surprise-leak.
// All API handlers MUST derive coupleId/authorId from `locals`, never
// from the request body, since service-role Drizzle bypasses RLS here.

import { and, asc, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { scheduledNotes } from '$lib/server/db/app.schema';
import {
	MIN_LEAD_TIME_MS,
	MAX_LEAD_TIME_MS,
	MAX_BODY_LEN,
	MAX_PENDING_PER_AUTHOR
} from '$lib/scheduledNotes.constants';

export { MIN_LEAD_TIME_MS, MAX_LEAD_TIME_MS, MAX_BODY_LEN, MAX_PENDING_PER_AUTHOR };

export type PendingNote = {
	id: string;
	body: string;
	deliverAt: Date;
	createdAt: Date;
};

export type DeliveredNote = {
	id: string;
	authorId: string;
	body: string;
	deliverAt: Date;
	deliveredAt: Date;
};

export class ScheduledNoteValidationError extends Error {
	constructor(
		message: string,
		readonly code: 'too_soon' | 'too_far' | 'body_empty' | 'body_too_long' | 'quota_exceeded'
	) {
		super(message);
		this.name = 'ScheduledNoteValidationError';
	}
}

/**
 * Validate + insert a new scheduled note. Caller MUST source `coupleId`
 * and `authorId` from the authenticated session (`locals`), never the
 * request body — Drizzle bypasses RLS.
 */
export async function scheduleNote(input: {
	coupleId: string;
	authorId: string;
	body: string;
	deliverAt: Date;
	now?: Date;
}): Promise<{ id: string; deliverAt: Date }> {
	const now = input.now ?? new Date();
	const trimmed = input.body.trim();
	if (trimmed.length === 0) {
		throw new ScheduledNoteValidationError('body is empty', 'body_empty');
	}
	if (trimmed.length > MAX_BODY_LEN) {
		throw new ScheduledNoteValidationError(
			`body exceeds ${MAX_BODY_LEN} characters`,
			'body_too_long'
		);
	}
	const lead = input.deliverAt.getTime() - now.getTime();
	if (lead < MIN_LEAD_TIME_MS) {
		throw new ScheduledNoteValidationError(
			'deliverAt must be at least 5 minutes in the future',
			'too_soon'
		);
	}
	if (lead > MAX_LEAD_TIME_MS) {
		throw new ScheduledNoteValidationError('deliverAt must be within 10 years', 'too_far');
	}

	const [pendingCount] = await db
		.select({ n: sql<number>`count(*)::int` })
		.from(scheduledNotes)
		.where(and(eq(scheduledNotes.authorId, input.authorId), isNull(scheduledNotes.deliveredAt)));
	if ((pendingCount?.n ?? 0) >= MAX_PENDING_PER_AUTHOR) {
		throw new ScheduledNoteValidationError(
			`already have ${MAX_PENDING_PER_AUTHOR} pending notes`,
			'quota_exceeded'
		);
	}

	const [row] = await db
		.insert(scheduledNotes)
		.values({
			coupleId: input.coupleId,
			authorId: input.authorId,
			body: trimmed,
			deliverAt: input.deliverAt
		})
		.returning({ id: scheduledNotes.id, deliverAt: scheduledNotes.deliverAt });
	return row;
}

/**
 * Cancel an undelivered note. No-op if the row is already delivered or
 * not owned by this author (returns false).
 */
export async function cancelNote(input: { id: string; authorId: string }): Promise<boolean> {
	const result = await db
		.delete(scheduledNotes)
		.where(
			and(
				eq(scheduledNotes.id, input.id),
				eq(scheduledNotes.authorId, input.authorId),
				isNull(scheduledNotes.deliveredAt)
			)
		)
		.returning({ id: scheduledNotes.id });
	return result.length > 0;
}

/** Author's own pending notes (oldest deliverAt first). */
export async function listPendingForAuthor(authorId: string): Promise<PendingNote[]> {
	const rows = await db
		.select({
			id: scheduledNotes.id,
			body: scheduledNotes.body,
			deliverAt: scheduledNotes.deliverAt,
			createdAt: scheduledNotes.createdAt
		})
		.from(scheduledNotes)
		.where(and(eq(scheduledNotes.authorId, authorId), isNull(scheduledNotes.deliveredAt)))
		.orderBy(asc(scheduledNotes.deliverAt));
	return rows;
}

/** Couple-scoped delivered feed (visible to both partners). */
export async function listDeliveredForCouple(coupleId: string): Promise<DeliveredNote[]> {
	const rows = await db
		.select({
			id: scheduledNotes.id,
			authorId: scheduledNotes.authorId,
			body: scheduledNotes.body,
			deliverAt: scheduledNotes.deliverAt,
			deliveredAt: scheduledNotes.deliveredAt
		})
		.from(scheduledNotes)
		.where(and(eq(scheduledNotes.coupleId, coupleId), isNotNull(scheduledNotes.deliveredAt)))
		.orderBy(desc(scheduledNotes.deliveredAt))
		.limit(200);
	return rows.map((r) => ({
		id: r.id,
		authorId: r.authorId,
		body: r.body,
		deliverAt: r.deliverAt,
		deliveredAt: r.deliveredAt as Date
	}));
}

/**
 * Atomically claim due notes and enqueue partner pushes (rubber-duck #1, #2).
 *
 *   WITH due AS (
 *     UPDATE scheduled_notes
 *     SET delivered_at = now()
 *     WHERE id IN (SELECT id … WHERE deliver_at <= now() FOR UPDATE SKIP LOCKED LIMIT N)
 *     RETURNING …
 *   )
 *   INSERT INTO push_outbox (…)
 *   SELECT … FROM due JOIN couple ON …
 *   ON CONFLICT (recipient_id, dedupe_key) DO NOTHING;
 *
 * The CTE runs in a single auto-commit statement, so the row-level lock
 * survives across SELECT and UPDATE inside Postgres. Pgbouncer
 * transaction-mode is fine for that — the lock is implicit to the same
 * statement. The unique index `push_outbox_dedupe_idx` plus a per-note
 * dedupe_key (`scheduled_note:<id>`) makes outbox enqueue idempotent
 * across cron retries.
 *
 * Returns the number of notes delivered (also = the number of outbox
 * rows attempted; some may have been skipped via ON CONFLICT if a
 * previous attempt already enqueued them).
 */
export async function deliverDue(now: Date = new Date(), batchSize = 50): Promise<number> {
	const result = await db.execute(sql`
		with due as (
			update scheduled_notes
			set delivered_at = ${now.toISOString()}
			where id in (
				select id
				from scheduled_notes
				where delivered_at is null and deliver_at <= ${now.toISOString()}
				order by deliver_at
				for update skip locked
				limit ${batchSize}
			)
			returning id, couple_id, author_id, body
		),
		recipient as (
			select due.id as note_id,
				due.couple_id,
				due.author_id,
				due.body,
				case
					when c.partner_a = due.author_id then c.partner_b
					else c.partner_a
				end as recipient_id
			from due
			join couple c on c.id = due.couple_id
		)
		insert into push_outbox (couple_id, recipient_id, kind, title, body, data_json, dedupe_key)
		select
			r.couple_id,
			r.recipient_id,
			'scheduled_note',
			coalesce(p.display_name, 'Your partner') || ' sent you a time capsule',
			substring(r.body from 1 for 140),
			json_build_object('noteId', r.note_id)::text,
			'scheduled_note:' || r.note_id
		from recipient r
		left join profile p on p.user_id = r.author_id
		on conflict (recipient_id, dedupe_key) do nothing
		returning recipient_id;
	`);

	// `db.execute` for a CTE may return either an array of rows or a
	// driver-shaped object. Normalize and count rows the INSERT actually
	// returned (= number of NEW outbox rows; some may have been skipped
	// via ON CONFLICT). For accurate "delivered" count we want the
	// cardinality of `due`, not of the INSERT — but if any row hit the
	// conflict it means the previous cron already enqueued it (so the
	// note was effectively delivered before). Either way, this number
	// is a lower bound and good enough for telemetry.
	const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows) ?? [];
	return rows.length;
}
