// F11 — Hourly diary service.
//
// Per-user 2-second camera-only clips + 5-emoji mood, bucketed by the
// hour. Both partners see each other's day side-by-side in /hourly.
//
// Pipeline (browser → Supabase Storage direct upload, Worker mints urls):
//   1. Browser POSTs /api/hourly/upload-attempt
//      → server derives hourBucket from server clock (never client),
//        picks an immutable storage key
//        `{couple}/{YYYYMMDDHH}/{user}/{attempt}.webm`,
//        inserts hourly_clip_attempt with expires_at = min(now+60s, hourBoundary),
//        mints a signed upload URL with the same TTL,
//        returns { attemptId, uploadUrl, storageKey, expiresAt }
//   2. Browser PUTs the recorded blob directly to Storage. Worker is
//      not in the body path — keeps us under CF body/CPU limits and
//      avoids the 100MB upload fee surface.
//   3. Browser POSTs /api/hourly/finalize { attemptId }
//      → server re-validates time still within attempt window,
//        queries Storage metadata for size + mime,
//        upserts hourly_clip (marking any prior ready row delete_pending),
//        broadcasts metadata-only `hourly_clip` event.
//
// Privacy: hourly_mood RLS only allows partner SELECT on rows ≤24h
// old; `getDay` mirrors that filter so the Drizzle (RLS-bypass) read
// stays product-aligned. Older rows stay owner-only.
//
// Two-phase delete: TTL purge marks rows `delete_pending` (cron
// 0025_hourly.sql); a separate worker `purgeDeletePending()` drains
// the queue by removing the storage object then hard-deleting the row.
// This is the only safe pattern when row-delete and object-delete are
// in different systems — see architecture review.

import { and, asc, eq, gte, isNull, lt, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { hourlyClip, hourlyClipAttempt, hourlyMood, hourlyPushWindow } from '$lib/server/db/schema';
import { broadcastToCouple } from '$lib/server/realtime';
import { createSupabaseAdminClient } from '$lib/server/supabase';

export const HOURLY_BUCKET_NAME = 'hourly-clips';
export const HOURLY_CLIP_RETENTION_DAYS = 2;
/** Cross-partner SELECT window for hourly_mood. Keep in sync with
 * the RLS predicate in drizzle/manual/0025_hourly.sql. */
export const HOURLY_MOOD_PARTNER_VISIBLE_HOURS = 24;
export const HOURLY_CLIP_MAX_BYTES = 750_000;
export const HOURLY_ATTEMPT_MAX_SECONDS = 60;
export const HOURLY_CAPTION_MAX_CHARS = 280;
export const HOURLY_ALLOWED_MIMES = ['video/webm', 'video/mp4'] as const;
export type HourlyMime = (typeof HOURLY_ALLOWED_MIMES)[number];
export const HOURLY_MOODS = ['joyful', 'happy', 'neutral', 'sad', 'upset'] as const;
export type HourlyMood = (typeof HOURLY_MOODS)[number];

export class HourlyError extends Error {
	constructor(
		message: string,
		readonly code:
			| 'invalid_mime'
			| 'invalid_mood'
			| 'invalid_caption'
			| 'clip_not_found'
			| 'clip_owner_mismatch'
			| 'clip_not_current_hour'
			| 'attempt_not_found'
			| 'attempt_expired'
			| 'attempt_owner_mismatch'
			| 'attempt_already_finalized'
			| 'storage_object_missing'
			| 'storage_object_too_large'
			| 'storage_object_mime_mismatch'
			| 'rate_limited'
	) {
		super(message);
		this.name = 'HourlyError';
	}
}

/** Normalize + length-check user-supplied captions. Returns null for
 *  blank input. Throws on overlong. */
export function normalizeCaption(input: unknown): string | null {
	if (input === null || input === undefined) return null;
	if (typeof input !== 'string') throw new HourlyError('invalid caption type', 'invalid_caption');
	const trimmed = input.trim();
	if (trimmed.length === 0) return null;
	if (trimmed.length > HOURLY_CAPTION_MAX_CHARS) {
		throw new HourlyError('caption too long', 'invalid_caption');
	}
	return trimmed;
}

export function isHourlyMime(v: unknown): v is HourlyMime {
	return typeof v === 'string' && (HOURLY_ALLOWED_MIMES as readonly string[]).includes(v);
}

export function isHourlyMood(v: unknown): v is HourlyMood {
	return typeof v === 'string' && (HOURLY_MOODS as readonly string[]).includes(v);
}

/** UTC-truncated current hour. Server-authoritative; never trust client time. */
export function currentHourBucket(now: Date = new Date()): Date {
	const d = new Date(now);
	d.setUTCMinutes(0, 0, 0);
	return d;
}

/** Path-safe hour stamp `YYYYMMDDHH` (UTC). Avoids ISO colons that bite URL parsers. */
export function formatHourPath(hourBucket: Date): string {
	const y = hourBucket.getUTCFullYear();
	const m = String(hourBucket.getUTCMonth() + 1).padStart(2, '0');
	const d = String(hourBucket.getUTCDate()).padStart(2, '0');
	const h = String(hourBucket.getUTCHours()).padStart(2, '0');
	return `${y}${m}${d}${h}`;
}

export function buildStorageKey(args: {
	coupleId: string;
	hourBucket: Date;
	userId: string;
	attemptId: string;
	mime: HourlyMime;
}): string {
	const ext = args.mime === 'video/mp4' ? 'mp4' : 'webm';
	return `${args.coupleId}/${formatHourPath(args.hourBucket)}/${args.userId}/${args.attemptId}.${ext}`;
}

/** Seconds remaining until the next hour boundary (server clock). */
export function secondsUntilBoundary(now: Date, hourBucket: Date): number {
	const boundaryMs = hourBucket.getTime() + 3600_000;
	return Math.max(1, Math.floor((boundaryMs - now.getTime()) / 1000));
}

export interface UploadAttempt {
	attemptId: string;
	uploadUrl: string;
	storageKey: string;
	expiresAt: string;
	hourBucket: string;
}

/**
 * Issue a server-derived upload attempt. The Worker never sees the
 * video bytes — the returned `uploadUrl` is a Supabase signed upload
 * URL and the browser PUTs directly to storage.
 */
export async function issueUploadAttempt(input: {
	coupleId: string;
	userId: string;
	mime: HourlyMime;
	now?: Date;
}): Promise<UploadAttempt> {
	if (!isHourlyMime(input.mime)) throw new HourlyError('invalid mime', 'invalid_mime');

	const now = input.now ?? new Date();
	const hourBucket = currentHourBucket(now);
	const ttlSeconds = Math.min(HOURLY_ATTEMPT_MAX_SECONDS, secondsUntilBoundary(now, hourBucket));
	const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

	const [row] = await db
		.insert(hourlyClipAttempt)
		.values({
			coupleId: input.coupleId,
			userId: input.userId,
			hourBucket,
			storageKey: '', // filled below now we know the row id
			expiresAt
		})
		.returning({ id: hourlyClipAttempt.id });

	const storageKey = buildStorageKey({
		coupleId: input.coupleId,
		hourBucket,
		userId: input.userId,
		attemptId: row.id,
		mime: input.mime
	});

	await db.update(hourlyClipAttempt).set({ storageKey }).where(eq(hourlyClipAttempt.id, row.id));

	const supabase = createSupabaseAdminClient();
	const { data, error } = await supabase.storage
		.from(HOURLY_BUCKET_NAME)
		.createSignedUploadUrl(storageKey);
	if (error || !data) {
		throw new Error(`createSignedUploadUrl failed: ${error?.message ?? 'unknown'}`);
	}

	return {
		attemptId: row.id,
		uploadUrl: data.signedUrl,
		storageKey,
		expiresAt: expiresAt.toISOString(),
		hourBucket: hourBucket.toISOString()
	};
}

export interface FinalizedClip {
	id: string;
	hourBucket: string;
	mime: HourlyMime;
	byteSize: number;
	caption: string | null;
	createdAt: string;
}

/**
 * Promote a successfully-uploaded attempt to a `ready` hourly_clip row.
 * Re-validates server time + storage object metadata. Marks any prior
 * `ready` row for the same hour as `delete_pending`. Broadcasts a
 * metadata-only realtime event (no signed URLs in payload).
 */
export async function finalizeClipAttempt(input: {
	coupleId: string;
	userId: string;
	attemptId: string;
	caption?: string | null;
	now?: Date;
}): Promise<FinalizedClip> {
	const now = input.now ?? new Date();
	const caption = normalizeCaption(input.caption);

	const [attempt] = await db
		.select()
		.from(hourlyClipAttempt)
		.where(eq(hourlyClipAttempt.id, input.attemptId))
		.limit(1);

	if (!attempt) throw new HourlyError('attempt not found', 'attempt_not_found');
	if (attempt.userId !== input.userId || attempt.coupleId !== input.coupleId) {
		throw new HourlyError('owner mismatch', 'attempt_owner_mismatch');
	}
	if (attempt.finalizedAt) {
		throw new HourlyError('already finalized', 'attempt_already_finalized');
	}
	if (attempt.expiresAt.getTime() < now.getTime()) {
		throw new HourlyError('expired', 'attempt_expired');
	}

	// Verify the storage object exists with the expected size + mime.
	// Trusting the client's claim would let a malicious upload exceed
	// HOURLY_CLIP_MAX_BYTES or land an unsupported codec.
	//
	// We prefer info() over list() because list() can return stale or
	// empty metadata immediately after a signed-URL upload, leaving
	// `size` undefined and tripping the size guard below.
	const supabase = createSupabaseAdminClient();
	let byteSize = 0;
	let mime: string | undefined;
	const { data: infoData, error: infoErr } = await supabase.storage
		.from(HOURLY_BUCKET_NAME)
		.info(attempt.storageKey);
	if (infoErr) {
		// Fall back to list-based metadata for older Storage backends
		// that don't expose the /object/info endpoint.
		const folder = attempt.storageKey.substring(0, attempt.storageKey.lastIndexOf('/'));
		const fileName = attempt.storageKey.substring(attempt.storageKey.lastIndexOf('/') + 1);
		const { data: listed, error: listErr } = await supabase.storage
			.from(HOURLY_BUCKET_NAME)
			.list(folder, { search: fileName, limit: 1 });
		if (listErr)
			throw new Error(`storage info+list failed: ${infoErr.message} / ${listErr.message}`);
		const obj = listed?.find((o: { name: string }) => o.name === fileName);
		if (!obj) throw new HourlyError('object missing', 'storage_object_missing');
		const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string };
		byteSize = typeof meta.size === 'number' ? meta.size : 0;
		mime = meta.mimetype;
	} else if (!infoData) {
		throw new HourlyError('object missing', 'storage_object_missing');
	} else {
		byteSize = typeof infoData.size === 'number' ? infoData.size : 0;
		mime = infoData.contentType;
	}

	// Strip codec parameters (e.g. `video/webm;codecs=vp9,opus`) before
	// validating against the allowed mime list.
	const baseMime = (mime ?? 'video/webm').split(';')[0].trim().toLowerCase();

	if (byteSize <= 0 || byteSize > HOURLY_CLIP_MAX_BYTES) {
		throw new HourlyError(`object size invalid: ${byteSize}`, 'storage_object_too_large');
	}
	if (!isHourlyMime(baseMime)) {
		throw new HourlyError(
			`mime mismatch: got "${mime ?? 'undefined'}"`,
			'storage_object_mime_mismatch'
		);
	}
	const finalMime: HourlyMime = baseMime;

	// Promote in a single transaction so the prior row's status flip
	// and the new row's INSERT can't be observed mid-flight.
	const finalized = await db.transaction(async (tx) => {
		await tx
			.update(hourlyClip)
			.set({ status: 'delete_pending' })
			.where(
				and(
					eq(hourlyClip.coupleId, input.coupleId),
					eq(hourlyClip.userId, input.userId),
					eq(hourlyClip.hourBucket, attempt.hourBucket),
					eq(hourlyClip.status, 'ready')
				)
			);

		const [inserted] = await tx
			.insert(hourlyClip)
			.values({
				coupleId: input.coupleId,
				userId: input.userId,
				hourBucket: attempt.hourBucket,
				storageKey: attempt.storageKey,
				mime: finalMime,
				byteSize,
				caption,
				status: 'ready'
			})
			.returning();

		await tx
			.update(hourlyClipAttempt)
			.set({ finalizedAt: now })
			.where(eq(hourlyClipAttempt.id, attempt.id));

		return inserted;
	});

	void broadcastToCouple(input.coupleId, {
		t: 'hourly_clip',
		ts: Date.now(),
		p: {
			id: finalized.id,
			userId: input.userId,
			hourBucket: attempt.hourBucket.toISOString()
		}
	}).catch((e) => console.warn('[hourly] clip broadcast failed', { id: finalized.id, e }));

	return {
		id: finalized.id,
		hourBucket: attempt.hourBucket.toISOString(),
		mime: finalMime,
		byteSize,
		caption,
		createdAt: finalized.createdAt.toISOString()
	};
}

/**
 * Update the caption on an existing clip. Only the owner of the clip
 * can edit it; the clip must still be in `ready` state. Broadcasts a
 * realtime tick so the partner's pager refetches.
 */
export async function setClipCaption(input: {
	coupleId: string;
	userId: string;
	clipId: string;
	caption: string | null;
}): Promise<{ id: string; caption: string | null }> {
	const caption = normalizeCaption(input.caption);
	const [clip] = await db.select().from(hourlyClip).where(eq(hourlyClip.id, input.clipId)).limit(1);
	if (!clip) throw new HourlyError('clip not found', 'clip_not_found');
	if (clip.coupleId !== input.coupleId || clip.userId !== input.userId) {
		throw new HourlyError('owner mismatch', 'clip_owner_mismatch');
	}
	if (clip.status !== 'ready') throw new HourlyError('clip not found', 'clip_not_found');

	await db.update(hourlyClip).set({ caption }).where(eq(hourlyClip.id, input.clipId));

	void broadcastToCouple(input.coupleId, {
		t: 'hourly_clip',
		ts: Date.now(),
		p: {
			id: clip.id,
			userId: input.userId,
			hourBucket: clip.hourBucket.toISOString()
		}
	}).catch((e) => console.warn('[hourly] caption broadcast failed', { id: clip.id, e }));

	return { id: clip.id, caption };
}

/**
 * Mark the owner's current-hour clip as `delete_pending`. Only allowed
 * for the clip belonging to the current UTC hour bucket so the user
 * can re-shoot; past clips are immutable history. The purge worker
 * actually removes the storage object + row asynchronously.
 */
export async function deleteCurrentHourClip(input: {
	coupleId: string;
	userId: string;
	clipId: string;
	now?: Date;
}): Promise<{ id: string }> {
	const now = input.now ?? new Date();
	const bucket = currentHourBucket(now);
	const [clip] = await db.select().from(hourlyClip).where(eq(hourlyClip.id, input.clipId)).limit(1);
	if (!clip) throw new HourlyError('clip not found', 'clip_not_found');
	if (clip.coupleId !== input.coupleId || clip.userId !== input.userId) {
		throw new HourlyError('owner mismatch', 'clip_owner_mismatch');
	}
	if (clip.hourBucket.getTime() !== bucket.getTime()) {
		throw new HourlyError('not current hour', 'clip_not_current_hour');
	}
	if (clip.status !== 'ready') return { id: clip.id };

	await db.update(hourlyClip).set({ status: 'delete_pending' }).where(eq(hourlyClip.id, clip.id));

	void broadcastToCouple(input.coupleId, {
		t: 'hourly_clip',
		ts: Date.now(),
		p: {
			id: clip.id,
			userId: input.userId,
			hourBucket: clip.hourBucket.toISOString()
		}
	}).catch((e) => console.warn('[hourly] delete broadcast failed', { id: clip.id, e }));

	return { id: clip.id };
}

export interface MoodSnapshot {
	hourBucket: string;
	mood: HourlyMood;
	createdAt: string;
}

/**
 * Set (upsert) the user's mood for the current hour. Mood-without-clip
 * is allowed by design.
 */
export async function setHourlyMoodNow(input: {
	coupleId: string;
	userId: string;
	mood: HourlyMood;
	now?: Date;
}): Promise<MoodSnapshot> {
	if (!isHourlyMood(input.mood)) throw new HourlyError('invalid mood', 'invalid_mood');
	const now = input.now ?? new Date();
	const hourBucket = currentHourBucket(now);

	const [row] = await db
		.insert(hourlyMood)
		.values({
			coupleId: input.coupleId,
			userId: input.userId,
			hourBucket,
			mood: input.mood
		})
		.onConflictDoUpdate({
			target: [hourlyMood.coupleId, hourlyMood.userId, hourlyMood.hourBucket],
			set: { mood: input.mood, createdAt: now }
		})
		.returning();

	void broadcastToCouple(input.coupleId, {
		t: 'hourly_mood',
		ts: Date.now(),
		p: { userId: input.userId, hourBucket: hourBucket.toISOString(), mood: input.mood }
	}).catch((e) => console.warn('[hourly] mood broadcast failed', { id: row.id, e }));

	return {
		hourBucket: hourBucket.toISOString(),
		mood: input.mood,
		createdAt: row.createdAt.toISOString()
	};
}

export interface DayCell {
	hourBucket: string;
	clip: {
		id: string;
		mime: HourlyMime;
		playbackUrl: string;
		expiresIn: number;
		caption: string | null;
	} | null;
	mood: HourlyMood | null;
}

export interface DayPayload {
	dateIso: string;
	you: { userId: string; cells: DayCell[] };
	partner: { userId: string | null; cells: DayCell[] };
}

const PLAYBACK_URL_TTL_SECONDS = 60;

/** Returns the side-by-side day grid. Mints fresh short-TTL playback
 *  URLs per call — never persists or logs them. */
export async function getDay(input: {
	coupleId: string;
	viewerId: string;
	partnerId: string | null;
	dateIso: string;
	now?: Date;
}): Promise<DayPayload> {
	const dayStart = new Date(`${input.dateIso}T00:00:00Z`);
	const dayEnd = new Date(dayStart.getTime() + 24 * 3600_000);
	const now = input.now ?? new Date();
	const partnerMoodFloor = new Date(now.getTime() - HOURLY_MOOD_PARTNER_VISIBLE_HOURS * 3600_000);

	const clips = await db
		.select()
		.from(hourlyClip)
		.where(
			and(
				eq(hourlyClip.coupleId, input.coupleId),
				eq(hourlyClip.status, 'ready'),
				gte(hourlyClip.hourBucket, dayStart),
				lt(hourlyClip.hourBucket, dayEnd)
			)
		);

	const moods = await db
		.select()
		.from(hourlyMood)
		.where(
			and(
				eq(hourlyMood.coupleId, input.coupleId),
				gte(hourlyMood.hourBucket, dayStart),
				lt(hourlyMood.hourBucket, dayEnd)
			)
		);

	const supabase = createSupabaseAdminClient();
	const playbackByKey = new Map<string, string>();
	for (const clip of clips) {
		const { data, error } = await supabase.storage
			.from(HOURLY_BUCKET_NAME)
			.createSignedUrl(clip.storageKey, PLAYBACK_URL_TTL_SECONDS);
		if (!error && data) playbackByKey.set(clip.storageKey, data.signedUrl);
	}

	function cellsFor(userId: string): DayCell[] {
		const cells: DayCell[] = [];
		for (let h = 0; h < 24; h++) {
			const hour = new Date(dayStart.getTime() + h * 3600_000);
			const clip = clips.find(
				(c) => c.userId === userId && c.hourBucket.getTime() === hour.getTime()
			);
			const mood = moods.find(
				(m) => m.userId === userId && m.hourBucket.getTime() === hour.getTime()
			);
			const partnerMoodHidden =
				userId !== input.viewerId && mood && mood.createdAt < partnerMoodFloor;
			cells.push({
				hourBucket: hour.toISOString(),
				clip: clip
					? {
							id: clip.id,
							mime: clip.mime as HourlyMime,
							playbackUrl: playbackByKey.get(clip.storageKey) ?? '',
							expiresIn: PLAYBACK_URL_TTL_SECONDS,
							caption: clip.caption
						}
					: null,
				mood: mood && !partnerMoodHidden ? (mood.mood as HourlyMood) : null
			});
		}
		return cells;
	}

	return {
		dateIso: input.dateIso,
		you: { userId: input.viewerId, cells: cellsFor(input.viewerId) },
		partner: {
			userId: input.partnerId,
			cells: input.partnerId ? cellsFor(input.partnerId) : []
		}
	};
}

export interface PushWindow {
	startHour: number;
	endHour: number;
	tz: string;
}

export async function getPushWindow(userId: string): Promise<PushWindow> {
	const [row] = await db
		.select()
		.from(hourlyPushWindow)
		.where(eq(hourlyPushWindow.userId, userId))
		.limit(1);
	if (!row) return { startHour: 9, endHour: 22, tz: 'UTC' };
	return { startHour: row.startHour, endHour: row.endHour, tz: row.tz };
}

export async function setPushWindow(input: {
	userId: string;
	startHour: number;
	endHour: number;
	tz: string;
}): Promise<PushWindow> {
	if (!Number.isInteger(input.startHour) || input.startHour < 0 || input.startHour > 23) {
		throw new HourlyError('invalid start_hour', 'invalid_mood');
	}
	if (!Number.isInteger(input.endHour) || input.endHour < 0 || input.endHour > 23) {
		throw new HourlyError('invalid end_hour', 'invalid_mood');
	}
	const tz = typeof input.tz === 'string' && input.tz.length <= 64 ? input.tz : 'UTC';
	await db
		.insert(hourlyPushWindow)
		.values({
			userId: input.userId,
			startHour: input.startHour,
			endHour: input.endHour,
			tz
		})
		.onConflictDoUpdate({
			target: hourlyPushWindow.userId,
			set: { startHour: input.startHour, endHour: input.endHour, tz, updatedAt: new Date() }
		});
	return { startHour: input.startHour, endHour: input.endHour, tz };
}

/**
 * Drainer for the delete-pending queue. Removes the storage object
 * first, then hard-deletes the row. Idempotent — orphan storage objects
 * are retried on each invocation. Caller chooses cadence (typically a
 * scheduled worker or post-request hook).
 */
export async function purgeDeletePending(limit = 50): Promise<{ removed: number; failed: number }> {
	const rows = await db
		.select({ id: hourlyClip.id, storageKey: hourlyClip.storageKey })
		.from(hourlyClip)
		.where(eq(hourlyClip.status, 'delete_pending'))
		.orderBy(asc(hourlyClip.createdAt))
		.limit(limit);

	if (rows.length === 0) return { removed: 0, failed: 0 };

	const supabase = createSupabaseAdminClient();
	let removed = 0;
	let failed = 0;
	for (const row of rows) {
		const { error: rmErr } = await supabase.storage
			.from(HOURLY_BUCKET_NAME)
			.remove([row.storageKey]);
		if (rmErr) {
			console.warn('[hourly] storage remove failed', { id: row.id, e: rmErr });
			failed++;
			continue;
		}
		await db.delete(hourlyClip).where(eq(hourlyClip.id, row.id));
		removed++;
	}
	return { removed, failed };
}

/**
 * Counterpart to purgeDeletePending for unfinalized attempts that the
 * cron has rotted out (`purge_stale_hourly_clip_attempts` deletes the
 * row, but the storage object — if the client did upload before
 * abandoning — needs an explicit Storage.remove). Best-effort.
 */
export async function purgeOrphanAttemptObjects(limit = 50): Promise<number> {
	const rows = await db
		.select({ id: hourlyClipAttempt.id, storageKey: hourlyClipAttempt.storageKey })
		.from(hourlyClipAttempt)
		.where(
			and(
				isNull(hourlyClipAttempt.finalizedAt),
				lt(hourlyClipAttempt.expiresAt, sql`now() - interval '15 minutes'`)
			)
		)
		.limit(limit);
	if (rows.length === 0) return 0;
	const supabase = createSupabaseAdminClient();
	const keys = rows.map((r) => r.storageKey).filter(Boolean);
	if (keys.length > 0) {
		const { error } = await supabase.storage.from(HOURLY_BUCKET_NAME).remove(keys);
		if (error) console.warn('[hourly] orphan-attempt remove failed', error);
	}
	return rows.length;
}
