/**
 * Geo-Moment service. All writes flow through here so endpoint code never
 * touches the table directly. RLS on `geo_moment` + `geo_moment_body` is
 * SELECT-only for end users; this module uses the privileged `db` (postgres
 * superuser) for inserts/updates/soft-deletes.
 *
 * Trust model: see docs/rls-model.md. The body lives in a separate table
 * gated by `(author_id = auth.uid() OR unlocked_by = auth.uid())`, so even
 * a misbehaving client cannot read a locked partner's body via supabase-js.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';

import { broadcastToCouple } from '$lib/server/realtime';
import { db } from '$lib/server/db';
import { geoMoment, geoMomentBody, locationPing } from '$lib/server/db/app.schema';

export class MomentError extends Error {
	constructor(public readonly code: MomentErrorCode) {
		super(code);
	}
}
type MomentErrorCode =
	| 'invalid_input'
	| 'not_author'
	| 'not_found'
	| 'no_couple'
	| 'body_too_long'
	| 'conflict';

export class MomentConflictError extends MomentError {
	constructor(public readonly current: MomentForViewer) {
		super('conflict');
	}
}

const MIN_RADIUS_M = 50;
const MAX_RADIUS_M = 1000;
const MAX_BODY_CHARS = 280;
const MAX_EXPIRY_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export interface CreateMomentInput {
	lat: number;
	lon: number;
	radiusM: number;
	body: string;
	expiresAt?: Date | null;
}

/**
 * Insert a new moment + its body atomically. Broadcasts `moment_dropped`
 * (metadata only, never the body). Returns the new id.
 */
export async function createMoment(
	authorId: string,
	coupleId: string,
	input: CreateMomentInput
): Promise<string> {
	const lat = Number(input.lat);
	const lon = Number(input.lon);
	const radiusM = Math.round(Number(input.radiusM));
	const body = String(input.body ?? '').trim();

	if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new MomentError('invalid_input');
	if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new MomentError('invalid_input');
	if (!Number.isFinite(radiusM) || radiusM < MIN_RADIUS_M || radiusM > MAX_RADIUS_M)
		throw new MomentError('invalid_input');
	if (body.length === 0) throw new MomentError('invalid_input');
	if (body.length > MAX_BODY_CHARS) throw new MomentError('body_too_long');

	let expiresAt: Date | null = null;
	if (input.expiresAt) {
		const t = input.expiresAt instanceof Date ? input.expiresAt : new Date(input.expiresAt);
		const ms = t.getTime();
		if (!Number.isFinite(ms) || ms <= Date.now()) throw new MomentError('invalid_input');
		expiresAt = new Date(Math.min(ms, Date.now() + MAX_EXPIRY_MS));
	}

	const created = await db.transaction(async (tx) => {
		const [row] = await tx
			.insert(geoMoment)
			.values({
				coupleId,
				authorId,
				lat,
				lon,
				radiusM,
				expiresAt
			})
			.returning({ id: geoMoment.id, createdAt: geoMoment.createdAt });
		await tx.insert(geoMomentBody).values({ momentId: row.id, body });
		return row;
	});

	void broadcastToCouple(coupleId, {
		t: 'moment_dropped',
		ts: Date.now(),
		p: {
			id: created.id,
			authorId,
			lat,
			lon,
			radiusM,
			createdAt: created.createdAt.toISOString(),
			expiresAt: expiresAt ? expiresAt.toISOString() : null
		}
	}).catch(() => {});

	return created.id;
}

export interface MomentForViewer {
	id: string;
	authorId: string;
	isMine: boolean;
	lat: number;
	lon: number;
	radiusM: number;
	createdAt: string;
	updatedAt: string;
	expiresAt: string | null;
	unlockedAt: string | null;
	unlockedBy: string | null;
	/** Null when the viewer has not unlocked the moment yet. */
	body: string | null;
}

/**
 * List visible moments for the viewer in a couple. `body` is included only
 * for moments the viewer authored or has unlocked. Excludes soft-deleted and
 * expired rows.
 */
export async function listMomentsForViewer(
	viewerId: string,
	coupleId: string
): Promise<MomentForViewer[]> {
	const rows = await db
		.select({
			id: geoMoment.id,
			authorId: geoMoment.authorId,
			lat: geoMoment.lat,
			lon: geoMoment.lon,
			radiusM: geoMoment.radiusM,
			createdAt: geoMoment.createdAt,
			updatedAt: geoMoment.updatedAt,
			expiresAt: geoMoment.expiresAt,
			unlockedAt: geoMoment.unlockedAt,
			unlockedBy: geoMoment.unlockedBy,
			body: geoMomentBody.body
		})
		.from(geoMoment)
		.leftJoin(geoMomentBody, eq(geoMomentBody.momentId, geoMoment.id))
		.where(
			and(
				eq(geoMoment.coupleId, coupleId),
				isNull(geoMoment.deletedAt),
				sql`(${geoMoment.expiresAt} is null or ${geoMoment.expiresAt} > now())`
			)
		)
		.orderBy(desc(geoMoment.createdAt));

	return rows.map((r) => {
		const isMine = r.authorId === viewerId;
		const visible = isMine || r.unlockedBy === viewerId;
		return {
			id: r.id,
			authorId: r.authorId,
			isMine,
			lat: r.lat,
			lon: r.lon,
			radiusM: r.radiusM,
			createdAt: r.createdAt.toISOString(),
			updatedAt: r.updatedAt.toISOString(),
			expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
			unlockedAt: r.unlockedAt ? r.unlockedAt.toISOString() : null,
			unlockedBy: r.unlockedBy,
			body: visible ? r.body : null
		};
	});
}

const MAX_UNLOCK_PING_AGE_MS = 5 * 60 * 1000;
const MAX_UNLOCK_ACCURACY_M = 200;

/**
 * Atomically unlock every locked, non-author moment in the couple whose
 * radius contains the candidate ping. Called from `recordPing` (and any
 * future server-side proximity tick). Re-runs even if the ping itself is
 * dropped by movement throttling — see critique #4.
 *
 * Skipped if the unlocking user is currently ghosted (we don't want to
 * leak presence as a side-effect of moments — see critique #5).
 *
 * The UPDATE … RETURNING runs in one statement so concurrent pings cannot
 * double-broadcast (critique #3). Broadcasts each unlock event.
 */
export async function unlockMomentsForPing(
	userId: string,
	coupleId: string,
	candidate: { lat: number; lon: number; accuracyM?: number },
	opts: { ghosted: boolean }
): Promise<{ id: string; unlockedAt: Date }[]> {
	if (opts.ghosted) return [];
	const acc = Math.min(Math.max(0, candidate.accuracyM ?? 0), MAX_UNLOCK_ACCURACY_M);
	const candidateGeog = sql`st_setsrid(st_makepoint(${candidate.lon}, ${candidate.lat}), 4326)::geography`;

	const unlocked = await db.execute<{ id: string; unlocked_at: Date }>(sql`
		update public.geo_moment gm
		set unlocked_at = now(),
		    unlocked_by = ${userId}::uuid
		where gm.couple_id = ${coupleId}::uuid
		  and gm.author_id <> ${userId}::uuid
		  and gm.unlocked_at is null
		  and gm.deleted_at is null
		  and (gm.expires_at is null or gm.expires_at > now())
		  and st_dwithin(gm.geog, ${candidateGeog}, gm.radius_m + ${acc})
		returning gm.id, gm.unlocked_at
	`);

	const rows =
		(unlocked as unknown as { rows?: Array<{ id: string; unlocked_at: Date }> }).rows ??
		(unlocked as unknown as Array<{ id: string; unlocked_at: Date }>);

	for (const r of rows ?? []) {
		void broadcastToCouple(coupleId, {
			t: 'moment_unlocked',
			ts: Date.now(),
			p: {
				id: r.id,
				unlockedBy: userId,
				unlockedAt: new Date(r.unlocked_at).toISOString()
			}
		}).catch(() => {});
	}

	return (rows ?? []).map((r) => ({ id: r.id, unlockedAt: new Date(r.unlocked_at) }));
}

/**
 * Soft-delete a moment. Author-only. If the moment was already unlocked we
 * keep the row + body but stamp `deleted_at` so the partner's UI can
 * reconcile via `moment_deleted`. If still locked, hard-delete via cascade.
 */
export async function deleteMoment(
	authorId: string,
	coupleId: string,
	momentId: string
): Promise<void> {
	const [row] = await db
		.select({
			authorId: geoMoment.authorId,
			coupleId: geoMoment.coupleId,
			unlockedAt: geoMoment.unlockedAt,
			deletedAt: geoMoment.deletedAt
		})
		.from(geoMoment)
		.where(eq(geoMoment.id, momentId))
		.limit(1);

	if (!row || row.coupleId !== coupleId || row.deletedAt) throw new MomentError('not_found');
	if (row.authorId !== authorId) throw new MomentError('not_author');

	if (row.unlockedAt) {
		await db.update(geoMoment).set({ deletedAt: new Date() }).where(eq(geoMoment.id, momentId));
	} else {
		await db.delete(geoMoment).where(eq(geoMoment.id, momentId));
	}

	void broadcastToCouple(coupleId, {
		t: 'moment_deleted',
		ts: Date.now(),
		p: { id: momentId }
	}).catch(() => {});
}

/** Used by the seed/reset script. Helper, not part of the trust boundary. */
export async function _internalResetMomentsForCouple(coupleId: string) {
	await db.delete(geoMoment).where(eq(geoMoment.coupleId, coupleId));
}

export interface UpdateMomentInput {
	body?: string;
	radiusM?: number;
	expiresAt?: Date | string | null;
	/** Last-write-wins guard. ISO string of the updatedAt the client last
	 * observed. If the row has moved on, we throw `MomentConflictError`
	 * with the freshest server view. */
	ifMatchUpdatedAt: string;
}

/**
 * Get a single moment for a viewer. Returns null when the row is missing,
 * soft-deleted, expired, or belongs to a different couple. Body is redacted
 * for non-author / non-unlocker viewers (matches `listMomentsForViewer`).
 */
export async function getMomentForViewer(
	viewerId: string,
	coupleId: string,
	momentId: string
): Promise<MomentForViewer | null> {
	const [r] = await db
		.select({
			id: geoMoment.id,
			authorId: geoMoment.authorId,
			lat: geoMoment.lat,
			lon: geoMoment.lon,
			radiusM: geoMoment.radiusM,
			createdAt: geoMoment.createdAt,
			updatedAt: geoMoment.updatedAt,
			expiresAt: geoMoment.expiresAt,
			unlockedAt: geoMoment.unlockedAt,
			unlockedBy: geoMoment.unlockedBy,
			body: geoMomentBody.body
		})
		.from(geoMoment)
		.leftJoin(geoMomentBody, eq(geoMomentBody.momentId, geoMoment.id))
		.where(
			and(
				eq(geoMoment.id, momentId),
				eq(geoMoment.coupleId, coupleId),
				isNull(geoMoment.deletedAt),
				sql`(${geoMoment.expiresAt} is null or ${geoMoment.expiresAt} > now())`
			)
		)
		.limit(1);
	if (!r) return null;
	const isMine = r.authorId === viewerId;
	const visible = isMine || r.unlockedBy === viewerId;
	return {
		id: r.id,
		authorId: r.authorId,
		isMine,
		lat: r.lat,
		lon: r.lon,
		radiusM: r.radiusM,
		createdAt: r.createdAt.toISOString(),
		updatedAt: r.updatedAt.toISOString(),
		expiresAt: r.expiresAt ? r.expiresAt.toISOString() : null,
		unlockedAt: r.unlockedAt ? r.unlockedAt.toISOString() : null,
		unlockedBy: r.unlockedBy,
		body: visible ? r.body : null
	};
}

/**
 * Author-only edit with optimistic concurrency. Two devices editing the
 * same moment race here — the loser's `ifMatchUpdatedAt` no longer
 * matches the row's `updated_at` and we throw `MomentConflictError` with
 * the current server view so the client can show the loser-toast. The
 * actual UPDATE is gated by a WHERE on `updated_at` to make this
 * atomic; we then re-read inside the same transaction.
 */
export async function updateMoment(
	authorId: string,
	coupleId: string,
	momentId: string,
	patch: UpdateMomentInput
): Promise<MomentForViewer> {
	const ifMatch = new Date(patch.ifMatchUpdatedAt);
	if (Number.isNaN(ifMatch.getTime())) throw new MomentError('invalid_input');

	let nextRadius: number | undefined;
	if (patch.radiusM !== undefined) {
		const r = Math.round(Number(patch.radiusM));
		if (!Number.isFinite(r) || r < MIN_RADIUS_M || r > MAX_RADIUS_M)
			throw new MomentError('invalid_input');
		nextRadius = r;
	}

	let nextExpiresAt: Date | null | undefined;
	if (patch.expiresAt !== undefined) {
		if (patch.expiresAt === null) {
			nextExpiresAt = null;
		} else {
			const t = patch.expiresAt instanceof Date ? patch.expiresAt : new Date(patch.expiresAt);
			const ms = t.getTime();
			if (!Number.isFinite(ms) || ms <= Date.now()) throw new MomentError('invalid_input');
			nextExpiresAt = new Date(Math.min(ms, Date.now() + MAX_EXPIRY_MS));
		}
	}

	let nextBody: string | undefined;
	if (patch.body !== undefined) {
		const b = String(patch.body).trim();
		if (b.length === 0) throw new MomentError('invalid_input');
		if (b.length > MAX_BODY_CHARS) throw new MomentError('body_too_long');
		nextBody = b;
	}

	const updated = await db.transaction(async (tx) => {
		const [existing] = await tx
			.select({
				authorId: geoMoment.authorId,
				coupleId: geoMoment.coupleId,
				deletedAt: geoMoment.deletedAt,
				updatedAt: geoMoment.updatedAt
			})
			.from(geoMoment)
			.where(eq(geoMoment.id, momentId))
			.limit(1);
		if (!existing || existing.coupleId !== coupleId || existing.deletedAt) {
			throw new MomentError('not_found');
		}
		if (existing.authorId !== authorId) throw new MomentError('not_author');
		if (existing.updatedAt.getTime() !== ifMatch.getTime()) {
			return { conflict: true as const };
		}

		const metaPatch: Record<string, unknown> = {};
		if (nextRadius !== undefined) metaPatch.radiusM = nextRadius;
		if (nextExpiresAt !== undefined) metaPatch.expiresAt = nextExpiresAt;

		// Conditional UPDATE: requires updated_at to still match. The
		// trigger bumps updated_at to now() as part of the same
		// statement so concurrent writers cannot both succeed.
		if (Object.keys(metaPatch).length > 0) {
			const meta = await tx
				.update(geoMoment)
				.set(metaPatch)
				.where(and(eq(geoMoment.id, momentId), eq(geoMoment.updatedAt, existing.updatedAt)))
				.returning({ id: geoMoment.id });
			if (meta.length === 0) return { conflict: true as const };
		}

		if (nextBody !== undefined) {
			// upsert: a moment may have been authored before geo_moment_body
			// existed (defensive — shouldn't happen in normal flow).
			await tx
				.insert(geoMomentBody)
				.values({ momentId, body: nextBody })
				.onConflictDoUpdate({ target: geoMomentBody.momentId, set: { body: nextBody } });
		}

		// If neither metadata nor body was patched, still touch updated_at
		// so the round-trip returns a fresh value (treats no-op as a tick).
		if (Object.keys(metaPatch).length === 0 && nextBody === undefined) {
			await tx
				.update(geoMoment)
				.set({ updatedAt: new Date() })
				.where(and(eq(geoMoment.id, momentId), eq(geoMoment.updatedAt, existing.updatedAt)));
		}

		return { conflict: false as const };
	});

	if (updated.conflict) {
		const current = await getMomentForViewer(authorId, coupleId, momentId);
		if (!current) throw new MomentError('not_found');
		throw new MomentConflictError(current);
	}

	const fresh = await getMomentForViewer(authorId, coupleId, momentId);
	if (!fresh) throw new MomentError('not_found');

	void broadcastToCouple(coupleId, {
		t: 'moment_updated',
		ts: Date.now(),
		p: { id: momentId, updatedAt: fresh.updatedAt, updatedBy: authorId }
	}).catch(() => {});

	return fresh;
}

/** Re-export the latest accepted ping for a user — used to feed the unlock
 * check when the new ping was throttled by movement gating. */
export async function latestPingFor(
	userId: string
): Promise<{ lat: number; lon: number; accuracyM: number | null; capturedAt: Date } | null> {
	const [row] = await db
		.select({
			lat: locationPing.lat,
			lon: locationPing.lon,
			accuracyM: locationPing.accuracyM,
			capturedAt: locationPing.capturedAt
		})
		.from(locationPing)
		.where(eq(locationPing.userId, userId))
		.orderBy(desc(locationPing.capturedAt))
		.limit(1);
	if (!row) return null;
	if (Date.now() - row.capturedAt.getTime() > MAX_UNLOCK_PING_AGE_MS) return null;
	return row;
}
