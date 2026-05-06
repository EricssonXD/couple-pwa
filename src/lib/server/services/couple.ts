import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { couple, linkCode } from '$lib/server/db/schema';

// Unambiguous Crockford-ish charset: no 0/O/1/I/L.
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;
export const LINK_CODE_TTL_MS = 15 * 60 * 1000;

export class PairingError extends Error {
	constructor(
		public code: 'expired' | 'used' | 'not_found' | 'self_redeem' | 'already_paired' | 'collision',
		message: string
	) {
		super(message);
	}
}

function randomCode(): string {
	const bytes = new Uint8Array(CODE_LEN);
	crypto.getRandomValues(bytes);
	let out = '';
	for (let i = 0; i < CODE_LEN; i++) out += CHARSET[bytes[i] % CHARSET.length];
	return out;
}

/**
 * Issue a fresh single-use link code for the given user. Retries on
 * astronomically-unlikely PK collisions with live (unexpired, unused) codes.
 * Caller is responsible for ensuring the user is not already in an active couple.
 */
export async function issueLinkCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
	const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
	for (let attempt = 0; attempt < 5; attempt++) {
		const code = randomCode();
		try {
			await db.insert(linkCode).values({ code, issuerId: userId, expiresAt });
			return { code, expiresAt };
		} catch (err) {
			// Unique violation on the PK — try again with a new code.
			if (
				err &&
				typeof err === 'object' &&
				'code' in err &&
				(err as { code: string }).code === '23505'
			) {
				continue;
			}
			throw err;
		}
	}
	throw new PairingError('collision', 'Could not allocate unique link code');
}

/** Look up active couple for a user (as either partner). */
export async function getActiveCouple(userId: string) {
	const rows = await db
		.select()
		.from(couple)
		.where(
			and(eq(couple.status, 'active'), or(eq(couple.partnerA, userId), eq(couple.partnerB, userId)))
		)
		.limit(1);
	return rows[0] ?? null;
}

/**
 * Redeem a code: validate, then atomically create the couple and mark the
 * code consumed. Throws PairingError on any business-rule violation.
 */
export async function redeemLinkCode(code: string, redeemerId: string) {
	const normalized = code.trim().toUpperCase();
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select()
			.from(linkCode)
			.where(eq(linkCode.code, normalized))
			.for('update')
			.limit(1);
		if (!row) throw new PairingError('not_found', 'Invalid code');
		if (row.usedAt) throw new PairingError('used', 'Code already used');
		if (row.expiresAt.getTime() < Date.now()) throw new PairingError('expired', 'Code expired');
		if (row.issuerId === redeemerId)
			throw new PairingError('self_redeem', 'Cannot pair with yourself');

		// Either party already in an active couple? Block.
		const blockers = await tx
			.select({ id: couple.id })
			.from(couple)
			.where(
				and(
					eq(couple.status, 'active'),
					or(
						eq(couple.partnerA, redeemerId),
						eq(couple.partnerB, redeemerId),
						eq(couple.partnerA, row.issuerId),
						eq(couple.partnerB, row.issuerId)
					)
				)
			)
			.limit(1);
		if (blockers.length) throw new PairingError('already_paired', 'One of you is already paired');

		// Sort partner ids so the (a < b) check + unique pair index hold.
		const [a, b] = [row.issuerId, redeemerId].sort();
		const [created] = await tx
			.insert(couple)
			.values({ partnerA: a, partnerB: b, status: 'active' })
			.returning();

		await tx
			.update(linkCode)
			.set({ usedAt: new Date(), consumedBy: redeemerId })
			.where(eq(linkCode.code, normalized));

		return created;
	});
}

/** Return the most recent live (unused, unexpired) code for a user, if any. */
export async function getLiveLinkCode(userId: string) {
	const rows = await db
		.select()
		.from(linkCode)
		.where(
			and(
				eq(linkCode.issuerId, userId),
				isNull(linkCode.usedAt),
				gt(linkCode.expiresAt, new Date())
			)
		)
		.orderBy(sql`${linkCode.createdAt} desc`)
		.limit(1);
	return rows[0] ?? null;
}
