import { and, eq, isNotNull, lte, or } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { profile, couple } from '$lib/server/db/schema';
import { recordAudit } from './audit';

export const DELETION_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export class DeletionError extends Error {
	constructor(public code: 'not_found' | 'already_pending' | 'not_pending') {
		super(code);
	}
}

/**
 * Schedule the user's account for hard delete in DELETION_WINDOW_MS.
 * Side effects:
 *  - profile.pending_deletion_at = now + window
 *  - any active couple is uncoupled (status = 'broken') so the partner is
 *    not stuck holding a half-bond once the row gets purged.
 *
 * Idempotent in spirit: requesting twice is rejected with `already_pending`
 * so the UI can surface "you already scheduled deletion for X".
 */
export async function requestAccountDeletion(userId: string): Promise<{ pendingUntil: Date }> {
	const [me] = await db
		.select({ pendingDeletionAt: profile.pendingDeletionAt })
		.from(profile)
		.where(eq(profile.userId, userId))
		.limit(1);
	if (!me) throw new DeletionError('not_found');
	if (me.pendingDeletionAt && me.pendingDeletionAt > new Date()) {
		throw new DeletionError('already_pending');
	}

	const pendingUntil = new Date(Date.now() + DELETION_WINDOW_MS);
	await db
		.update(profile)
		.set({ pendingDeletionAt: pendingUntil })
		.where(eq(profile.userId, userId));

	// Best-effort uncouple: any active couple where this user is partner_a
	// or partner_b is flipped to broken so the partner is not stuck holding
	// a half-bond once the row gets purged.
	await db
		.update(couple)
		.set({ status: 'broken', brokenAt: new Date() })
		.where(
			and(eq(couple.status, 'active'), or(eq(couple.partnerA, userId), eq(couple.partnerB, userId)))
		);

	void recordAudit(userId, 'account.delete.request', { pendingUntil: pendingUntil.toISOString() });

	return { pendingUntil };
}

export async function cancelAccountDeletion(userId: string): Promise<void> {
	const [me] = await db
		.select({ pendingDeletionAt: profile.pendingDeletionAt })
		.from(profile)
		.where(eq(profile.userId, userId))
		.limit(1);
	if (!me) throw new DeletionError('not_found');
	if (!me.pendingDeletionAt) throw new DeletionError('not_pending');

	await db.update(profile).set({ pendingDeletionAt: null }).where(eq(profile.userId, userId));
	void recordAudit(userId, 'account.delete.cancel');
}

/**
 * Returns the deletion window for `userId` if the account is currently
 * in soft-delete state. `expired: true` means the window already elapsed
 * and the hook should sign the user out + queue a hard-delete.
 */
export async function readDeletionState(
	userId: string
): Promise<{ pendingUntil: Date; expired: boolean } | null> {
	const [me] = await db
		.select({ pendingDeletionAt: profile.pendingDeletionAt })
		.from(profile)
		.where(eq(profile.userId, userId))
		.limit(1);
	if (!me?.pendingDeletionAt) return null;
	return {
		pendingUntil: me.pendingDeletionAt,
		expired: me.pendingDeletionAt <= new Date()
	};
}

/**
 * Operator helper: list user IDs whose deletion window has expired and
 * are ready for hard delete via Supabase admin (out-of-band cron job).
 */
export async function listExpiredDeletions(now = new Date()): Promise<string[]> {
	const rows = await db
		.select({ userId: profile.userId })
		.from(profile)
		.where(and(isNotNull(profile.pendingDeletionAt), lte(profile.pendingDeletionAt, now)));
	return rows.map((r) => r.userId);
}
