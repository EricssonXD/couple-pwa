import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { couple, linkCode } from '$lib/server/db/schema';
import { recordAudit } from './audit';

// Unambiguous Crockford-ish charset: no 0/O/1/I/L.
const CHARSET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LEN = 6;
export const LINK_CODE_TTL_MS = 30 * 60 * 1000;

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
 * Look up *any* couple (active, paused, broken) the user belongs to.
 *
 * Pet routes use this so the shared pet stays accessible across pause /
 * unpair transitions (B1 — see pet-system.md §"Inactive couples"). The
 * default `event.locals.couple` is active-only by design and the rest of
 * the app relies on that invariant; we deliberately do NOT widen it.
 *
 * If the user belongs to multiple historic couples, the active one wins,
 * else the most recently updated row.
 */
export async function loadCoupleAnyStatus(userId: string) {
	const rows = await db
		.select()
		.from(couple)
		.where(or(eq(couple.partnerA, userId), eq(couple.partnerB, userId)))
		.orderBy(
			sql`case ${couple.status} when 'active' then 0 when 'paused' then 1 else 2 end`,
			sql`${couple.createdAt} desc`
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

// ─── Profile + couple-meta updates (M8 settings page) ─────────────────────
export class ProfileError extends Error {
	constructor(public readonly code: 'invalid_input' | 'not_paired') {
		super(code);
	}
}

const MAX_DISPLAY_NAME = 40;
const MAX_NICKNAME = 60;
// Allow 1–4 emoji-presentation graphemes for the avatar slot.
const EMOJI_OK = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]{1,4}$/u;

export async function updateProfile(
	userId: string,
	patch: { displayName?: string; avatarEmoji?: string }
) {
	const set: Record<string, unknown> = {};
	if (patch.displayName !== undefined) {
		const v = patch.displayName.trim();
		if (v.length === 0 || v.length > MAX_DISPLAY_NAME) throw new ProfileError('invalid_input');
		set.displayName = v;
	}
	if (patch.avatarEmoji !== undefined) {
		const v = patch.avatarEmoji.trim();
		if (!EMOJI_OK.test(v)) throw new ProfileError('invalid_input');
		set.avatarEmoji = v;
	}
	if (Object.keys(set).length === 0) return;
	const { profile } = await import('$lib/server/db/schema');
	await db.update(profile).set(set).where(eq(profile.userId, userId));
}

export async function updateCoupleMeta(
	userId: string,
	coupleId: string,
	patch: { nickname?: string | null; anniversary?: string | null }
) {
	const set: Record<string, unknown> = {};
	if (patch.nickname !== undefined) {
		const v = patch.nickname == null ? null : patch.nickname.trim();
		if (v && v.length > MAX_NICKNAME) throw new ProfileError('invalid_input');
		set.nickname = v && v.length > 0 ? v : null;
	}
	if (patch.anniversary !== undefined) {
		if (patch.anniversary == null || patch.anniversary === '') {
			set.anniversary = null;
		} else {
			if (!/^\d{4}-\d{2}-\d{2}$/.test(patch.anniversary)) throw new ProfileError('invalid_input');
			const d = new Date(patch.anniversary + 'T00:00:00Z');
			if (Number.isNaN(d.getTime())) throw new ProfileError('invalid_input');
			set.anniversary = patch.anniversary;
		}
	}
	if (Object.keys(set).length === 0) return;
	const res = await db
		.update(couple)
		.set(set)
		.where(
			and(eq(couple.id, coupleId), or(eq(couple.partnerA, userId), eq(couple.partnerB, userId)))
		);
	const rows = (res as unknown as { rowCount?: number }).rowCount;
	if (rows === 0) throw new ProfileError('not_paired');
}

/**
 * Either partner unilaterally unpairs. Flips status to 'broken' so the
 * partial unique active-couple indexes free up. History rows remain.
 */
export async function unpair(userId: string, coupleId: string) {
	await db
		.update(couple)
		.set({ status: 'broken', brokenAt: new Date() })
		.where(
			and(eq(couple.id, coupleId), or(eq(couple.partnerA, userId), eq(couple.partnerB, userId)))
		);
	void recordAudit(userId, 'unpair.request', { coupleId });
}
