import { and, desc, eq, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { couple, locationPing, locationDailySummary, profile } from '$lib/server/db/schema';
import { broadcastToCouple } from '$lib/server/realtime';

// Server-side guard rails. Client throttles too, but never trust it.
export const MIN_PING_INTERVAL_MS = 60 * 1000; // 60s
export const MIN_PING_MOVEMENT_M = 50;
// How long a fix is considered "live" before we degrade UI to "last seen".
export const PING_FRESHNESS_MS = 5 * 60 * 1000;
// Raw ping retention; older pings get folded into the daily summary.
export const PING_RETENTION_DAYS = 7;

export class LocationError extends Error {
	constructor(
		public code: 'rate_limited' | 'no_movement' | 'invalid' | 'no_couple',
		message: string
	) {
		super(message);
	}
}

export interface PingInput {
	lat: number;
	lon: number;
	accuracyM?: number;
	batteryPct?: number;
	charging?: boolean;
	headingDeg?: number;
	speedMps?: number;
	capturedAt: Date;
}

function validate(p: PingInput) {
	if (
		!Number.isFinite(p.lat) ||
		!Number.isFinite(p.lon) ||
		p.lat < -90 ||
		p.lat > 90 ||
		p.lon < -180 ||
		p.lon > 180
	) {
		throw new LocationError('invalid', 'lat/lon out of range');
	}
	if (!(p.capturedAt instanceof Date) || Number.isNaN(p.capturedAt.getTime())) {
		throw new LocationError('invalid', 'capturedAt invalid');
	}
	// Reject obviously-stale or future-dated reports (>10 min skew either way).
	const skew = Math.abs(Date.now() - p.capturedAt.getTime());
	if (skew > 10 * 60 * 1000) throw new LocationError('invalid', 'capturedAt skew too large');
}

/**
 * Insert a new ping if it passes the server-side rate limit + movement
 * threshold. Returns the inserted row, or `null` if the report was a no-op
 * (too soon / didn't move enough). Throws LocationError on hard failures.
 */
export async function recordPing(userId: string, coupleId: string, input: PingInput) {
	validate(input);

	// Fetch latest accepted ping for this user to apply rate + movement gates.
	const [last] = await db
		.select({
			capturedAt: locationPing.capturedAt,
			distM: sql<number>`ST_Distance(${locationPing.geog}, ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography)`
		})
		.from(locationPing)
		.where(eq(locationPing.userId, userId))
		.orderBy(desc(locationPing.capturedAt))
		.limit(1);

	if (last) {
		const sinceMs = input.capturedAt.getTime() - last.capturedAt.getTime();
		if (sinceMs < MIN_PING_INTERVAL_MS && Number(last.distM) < MIN_PING_MOVEMENT_M) {
			return null;
		}
	}

	const [row] = await db
		.insert(locationPing)
		.values({
			userId,
			coupleId,
			lat: input.lat,
			lon: input.lon,
			geog: sql`ST_SetSRID(ST_MakePoint(${input.lon}, ${input.lat}), 4326)::geography` as unknown as string,
			accuracyM: input.accuracyM,
			batteryPct: input.batteryPct,
			charging: input.charging,
			headingDeg: input.headingDeg,
			speedMps: input.speedMps,
			capturedAt: input.capturedAt
		})
		.returning();

	// Fire-and-forget: roll into daily summary. Failure here doesn't block the
	// response — worst case we lose a counter increment.
	void upsertDailySummary(userId, coupleId, input).catch(() => {});

	// Push live update to partner sockets. We compute fresh distance to the
	// partner's last known fix (if any) so the UI can update the bubble
	// without round-tripping /api/location/state.
	void broadcastLocation(userId, coupleId, input).catch(() => {});

	return row;
}

/** Compute distance to partner's latest ping and fan out a location_update. */
async function broadcastLocation(userId: string, coupleId: string, p: PingInput) {
	const [c] = await db.select().from(couple).where(eq(couple.id, coupleId)).limit(1);
	if (!c) return;
	const partnerId = c.partnerA === userId ? c.partnerB : c.partnerA;
	const [partnerLast] = await db
		.select({ lat: locationPing.lat, lon: locationPing.lon })
		.from(locationPing)
		.where(eq(locationPing.userId, partnerId))
		.orderBy(desc(locationPing.capturedAt))
		.limit(1);

	let distanceM: number | null = null;
	if (partnerLast) {
		const [{ d }] = await db.execute<{ d: number }>(
			sql`SELECT ST_Distance(
				ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326)::geography,
				ST_SetSRID(ST_MakePoint(${partnerLast.lon}, ${partnerLast.lat}), 4326)::geography
			) AS d`
		);
		distanceM = Number(d);
	}

	void broadcastToCouple(coupleId, {
		t: 'location_update',
		ts: Date.now(),
		p: {
			userId,
			distanceM,
			bucket: bucketFor(distanceM),
			batteryPct: p.batteryPct ?? null,
			charging: p.charging ?? null,
			capturedAt: p.capturedAt.toISOString()
		}
	}).catch(() => {});
}

async function upsertDailySummary(userId: string, coupleId: string, p: PingInput) {
	const day = p.capturedAt.toISOString().slice(0, 10);
	await db
		.insert(locationDailySummary)
		.values({
			userId,
			coupleId,
			day,
			pingCount: 1,
			firstLat: p.lat,
			firstLon: p.lon,
			lastLat: p.lat,
			lastLon: p.lon,
			distanceTraveledM: 0
		})
		.onConflictDoUpdate({
			target: [locationDailySummary.userId, locationDailySummary.day],
			set: {
				pingCount: sql`${locationDailySummary.pingCount} + 1`,
				lastLat: p.lat,
				lastLon: p.lon,
				distanceTraveledM: sql`
					${locationDailySummary.distanceTraveledM} + COALESCE(
						ST_Distance(
							ST_SetSRID(ST_MakePoint(${locationDailySummary.lastLon}, ${locationDailySummary.lastLat}), 4326)::geography,
							ST_SetSRID(ST_MakePoint(${p.lon}, ${p.lat}), 4326)::geography
						), 0
					)
				`
			}
		});
}

/** Latest ping for a single user (or null). */
export async function getLatestPing(userId: string) {
	const [row] = await db
		.select()
		.from(locationPing)
		.where(eq(locationPing.userId, userId))
		.orderBy(desc(locationPing.capturedAt))
		.limit(1);
	return row ?? null;
}

/**
 * Build the /pulse view-model: my latest ping, partner's latest ping, distance
 * between them, plus ghost flags so the route can render "隱身中" instead of
 * leaking distance.
 */
export async function getPulseState(userId: string, coupleId: string) {
	const [c] = await db.select().from(couple).where(eq(couple.id, coupleId)).limit(1);
	if (!c) throw new LocationError('no_couple', 'couple not found');
	const partnerId = c.partnerA === userId ? c.partnerB : c.partnerA;

	const [mine, theirs, partnerProf] = await Promise.all([
		getLatestPing(userId),
		getLatestPing(partnerId),
		db
			.select({ ghostMode: profile.ghostMode, ghostUntil: profile.ghostUntil })
			.from(profile)
			.where(eq(profile.userId, partnerId))
			.limit(1)
			.then((r) => r[0] ?? null)
	]);

	const partnerGhost = isGhostActive(partnerProf?.ghostMode ?? false, partnerProf?.ghostUntil);

	let distanceM: number | null = null;
	if (mine && theirs && !partnerGhost) {
		const [{ d }] = await db.execute<{ d: number }>(
			sql`SELECT ST_Distance(
				ST_SetSRID(ST_MakePoint(${mine.lon}, ${mine.lat}), 4326)::geography,
				ST_SetSRID(ST_MakePoint(${theirs.lon}, ${theirs.lat}), 4326)::geography
			) AS d`
		);
		distanceM = Number(d);
	}

	return {
		mine,
		partner: partnerGhost
			? // Strip every spatial detail the partner is hiding.
				{
					capturedAt: theirs?.capturedAt ?? null,
					batteryPct: null,
					charging: null,
					ghost: true as const
				}
			: theirs && {
					capturedAt: theirs.capturedAt,
					batteryPct: theirs.batteryPct,
					charging: theirs.charging,
					ghost: false as const
				},
		distanceM,
		partnerGhost
	};
}

export function isGhostActive(ghostMode: boolean, ghostUntil: Date | null | undefined): boolean {
	if (!ghostMode) return false;
	if (!ghostUntil) return true; // indefinite
	return ghostUntil.getTime() > Date.now();
}

export async function setGhostMode(userId: string, enabled: boolean, untilMs?: number) {
	await db
		.update(profile)
		.set({
			ghostMode: enabled,
			ghostUntil: enabled && untilMs ? new Date(untilMs) : null
		})
		.where(eq(profile.userId, userId));

	// Tell the partner immediately so their card flips without a refresh.
	const [c] = await db
		.select()
		.from(couple)
		.where(
			and(
				eq(couple.status, 'active'),
				sql`(${couple.partnerA} = ${userId} OR ${couple.partnerB} = ${userId})`
			)
		)
		.limit(1);
	if (c) {
		void broadcastToCouple(c.id, {
			t: 'ghost_change',
			ts: Date.now(),
			p: { userId, ghost: enabled }
		}).catch(() => {});
	}
}

// ─── Distance bucket (UI helper, server-mirror so APIs return same labels) ──
// Tighter bucket choice from MVP design: 50m / 500m / 5km.
export type DistanceBucket = 'together' | 'near' | 'same_city' | 'far' | 'unknown';
export function bucketFor(distanceM: number | null | undefined): DistanceBucket {
	if (distanceM == null || !Number.isFinite(distanceM)) return 'unknown';
	if (distanceM < 50) return 'together';
	if (distanceM < 500) return 'near';
	if (distanceM < 5_000) return 'same_city';
	return 'far';
}

/** Delete pings older than the retention window. Idempotent. */
export async function pruneOldPings() {
	const cutoff = new Date(Date.now() - PING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
	await db.delete(locationPing).where(sql`${locationPing.capturedAt} < ${cutoff}`);
}

// Retain reference to silence unused-import lint when we tree-shake.
void and;
