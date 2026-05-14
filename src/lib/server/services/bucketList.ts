// DuoSync — F6 Shared bucket-list service.
//
// Either partner can CRUD any item. RLS enforces couple membership;
// the service still validates input shape and quota. `markDone` and
// `markUndone` toggle done_at + done_by atomically.
//
// This service uses the service-role Drizzle client (bypasses RLS),
// so API handlers MUST derive coupleId from `locals.couple`, never
// from the request body.

import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { bucketItems } from '$lib/server/db/app.schema';
import { MAX_TITLE_LEN, MAX_NOTES_LEN, MAX_ITEMS_PER_COUPLE } from '$lib/bucketList.constants';
import { awardForEvent } from './pet';

export { MAX_TITLE_LEN, MAX_NOTES_LEN, MAX_ITEMS_PER_COUPLE };

export type BucketItem = {
	id: string;
	title: string;
	notes: string | null;
	targetDate: string | null;
	doneAt: Date | null;
	doneBy: string | null;
	createdBy: string;
	createdAt: Date;
	updatedAt: Date;
};

export class BucketItemValidationError extends Error {
	constructor(
		message: string,
		readonly code:
			| 'title_empty'
			| 'title_too_long'
			| 'notes_too_long'
			| 'invalid_target_date'
			| 'quota_exceeded'
	) {
		super(message);
		this.name = 'BucketItemValidationError';
	}
}

function normalizeTitle(raw: unknown): string {
	if (typeof raw !== 'string') {
		throw new BucketItemValidationError('title is required', 'title_empty');
	}
	const t = raw.trim();
	if (t.length === 0) throw new BucketItemValidationError('title is required', 'title_empty');
	if (t.length > MAX_TITLE_LEN)
		throw new BucketItemValidationError(`title exceeds ${MAX_TITLE_LEN} chars`, 'title_too_long');
	return t;
}

function normalizeNotes(raw: unknown): string | null {
	if (raw === undefined || raw === null) return null;
	if (typeof raw !== 'string') return null;
	const n = raw.trim();
	if (n.length === 0) return null;
	if (n.length > MAX_NOTES_LEN)
		throw new BucketItemValidationError(`notes exceeds ${MAX_NOTES_LEN} chars`, 'notes_too_long');
	return n;
}

function normalizeTargetDate(raw: unknown): string | null {
	if (raw === undefined || raw === null || raw === '') return null;
	if (typeof raw !== 'string') {
		throw new BucketItemValidationError('targetDate must be YYYY-MM-DD', 'invalid_target_date');
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
		throw new BucketItemValidationError('targetDate must be YYYY-MM-DD', 'invalid_target_date');
	}
	const d = new Date(raw + 'T00:00:00Z');
	if (Number.isNaN(d.getTime())) {
		throw new BucketItemValidationError('targetDate is not a valid date', 'invalid_target_date');
	}
	return raw;
}

export async function listForCouple(coupleId: string): Promise<BucketItem[]> {
	const rows = await db
		.select()
		.from(bucketItems)
		.where(eq(bucketItems.coupleId, coupleId))
		// Pending (doneAt is null) first by FIFO, then completed by recency.
		.orderBy(asc(bucketItems.doneAt), desc(bucketItems.createdAt));
	return rows.map((r) => ({
		id: r.id,
		title: r.title,
		notes: r.notes,
		targetDate: r.targetDate,
		doneAt: r.doneAt,
		doneBy: r.doneBy,
		createdBy: r.createdBy,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt
	}));
}

export async function createItem(input: {
	coupleId: string;
	createdBy: string;
	title: unknown;
	notes?: unknown;
	targetDate?: unknown;
}): Promise<BucketItem> {
	const title = normalizeTitle(input.title);
	const notes = normalizeNotes(input.notes);
	const targetDate = normalizeTargetDate(input.targetDate);

	const [{ count }] = await db
		.select({ count: sql<number>`count(*)::int` })
		.from(bucketItems)
		.where(eq(bucketItems.coupleId, input.coupleId));
	if (count >= MAX_ITEMS_PER_COUPLE) {
		throw new BucketItemValidationError(
			`Couple has reached the ${MAX_ITEMS_PER_COUPLE}-item cap`,
			'quota_exceeded'
		);
	}

	const [row] = await db
		.insert(bucketItems)
		.values({
			coupleId: input.coupleId,
			createdBy: input.createdBy,
			title,
			notes,
			targetDate
		})
		.returning();
	return {
		id: row.id,
		title: row.title,
		notes: row.notes,
		targetDate: row.targetDate,
		doneAt: row.doneAt,
		doneBy: row.doneBy,
		createdBy: row.createdBy,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt
	};
}

export async function updateItem(input: {
	id: string;
	coupleId: string;
	title?: unknown;
	notes?: unknown;
	targetDate?: unknown;
}): Promise<boolean> {
	const patch: Record<string, unknown> = {};
	if (input.title !== undefined) patch.title = normalizeTitle(input.title);
	if (input.notes !== undefined) patch.notes = normalizeNotes(input.notes);
	if (input.targetDate !== undefined) patch.targetDate = normalizeTargetDate(input.targetDate);
	if (Object.keys(patch).length === 0) return false;

	const result = await db
		.update(bucketItems)
		.set(patch)
		.where(and(eq(bucketItems.id, input.id), eq(bucketItems.coupleId, input.coupleId)))
		.returning({ id: bucketItems.id });
	return result.length > 0;
}

export async function markDone(input: {
	id: string;
	coupleId: string;
	doneBy: string;
}): Promise<boolean> {
	const result = await db
		.update(bucketItems)
		.set({ doneAt: new Date(), doneBy: input.doneBy })
		.where(
			and(
				eq(bucketItems.id, input.id),
				eq(bucketItems.coupleId, input.coupleId),
				isNull(bucketItems.doneAt)
			)
		)
		.returning({ id: bucketItems.id });
	const flipped = result.length > 0;
	if (flipped) {
		// Pet earn (P2.2): mutual full pay, deduped per item so
		// re-marking after un-mark doesn't re-award (intentional —
		// items can only earn once over their lifetime).
		await awardForEvent({
			coupleId: input.coupleId,
			userId: input.doneBy,
			source: 'bucket_complete',
			dedupeKey: `bucket_complete:${input.id}`,
			mutual: true
		});
	}
	return flipped;
}

export async function markUndone(input: { id: string; coupleId: string }): Promise<boolean> {
	const result = await db
		.update(bucketItems)
		.set({ doneAt: null, doneBy: null })
		.where(and(eq(bucketItems.id, input.id), eq(bucketItems.coupleId, input.coupleId)))
		.returning({ id: bucketItems.id });
	return result.length > 0;
}

export async function deleteItem(input: { id: string; coupleId: string }): Promise<boolean> {
	const result = await db
		.delete(bucketItems)
		.where(and(eq(bucketItems.id, input.id), eq(bucketItems.coupleId, input.coupleId)))
		.returning({ id: bucketItems.id });
	return result.length > 0;
}
