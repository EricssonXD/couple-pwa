// DuoSync — Memory Resurface service.
//
// "On this day" / Timehop-style retrieval. For now we surface the
// oldest geo_moment (with its body) created on the same calendar day
// in any prior year, with an N-day window for tolerance.
//
// Future expansion: photos from a shared album, chat highlights,
// "first ping together" milestone fallback when sparse.

import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';

export type Memory =
	| {
			kind: 'moment';
			id: string;
			authorId: string;
			body: string;
			lat: number;
			lon: number;
			createdAt: Date;
			daysAgo: number;
	  }
	| {
			kind: 'first_ping';
			capturedAt: Date;
			daysAgo: number;
	  };

const WINDOW_DAYS = 2;
const MIN_DAYS_AGO = 30;

function dayDiff(a: Date, b: Date): number {
	const ua = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
	const ub = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
	return Math.floor((ub - ua) / 86_400_000);
}

export async function resurfaceMemory(coupleId: string): Promise<Memory | null> {
	const now = new Date();

	// Find moments created on the same MM-DD in any prior year, within
	// WINDOW_DAYS, that are unlocked + have a body. Prefer the oldest
	// match to maximize "throwback" value.
	const result = await db.execute(sql`
		select gm.id, gm.author_id, gm.lat, gm.lon, gm.created_at, gmb.body
		from public.geo_moment gm
		join public.geo_moment_body gmb on gmb.moment_id = gm.id
		where gm.couple_id = ${coupleId}
			and gm.deleted_at is null
			and gm.unlocked_at is not null
			and gm.created_at < ${new Date(now.getTime() - MIN_DAYS_AGO * 86_400_000).toISOString()}
			and abs(
				extract(doy from gm.created_at)::int
				- extract(doy from now())::int
			) <= ${WINDOW_DAYS}
		order by gm.created_at asc
		limit 1
	`);

	const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows) ?? [];
	if (rows.length > 0) {
		const r = rows[0] as {
			id: string;
			author_id: string;
			lat: number;
			lon: number;
			created_at: string | Date;
			body: string;
		};
		const created = new Date(r.created_at);
		return {
			kind: 'moment',
			id: r.id,
			authorId: r.author_id,
			body: r.body,
			lat: Number(r.lat),
			lon: Number(r.lon),
			createdAt: created,
			daysAgo: dayDiff(created, now)
		};
	}

	// Fallback: first joint ping (= first time both partners pinged on
	// the same day). Cheap proxy: oldest ping for the couple.
	const firstPing = await db.execute(sql`
		select min(captured_at) as captured_at
		from public.location_ping
		where couple_id = ${coupleId}
	`);
	const fpRows =
		(Array.isArray(firstPing) ? firstPing : (firstPing as { rows?: unknown[] }).rows) ?? [];
	const fp = fpRows[0] as { captured_at: string | Date | null } | undefined;
	if (fp?.captured_at) {
		const captured = new Date(fp.captured_at);
		const days = dayDiff(captured, now);
		if (days >= MIN_DAYS_AGO) {
			return { kind: 'first_ping', capturedAt: captured, daysAgo: days };
		}
	}

	return null;
}
