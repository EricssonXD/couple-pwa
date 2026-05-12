// DuoSync — Connection streak service.
//
// A "connection" day is any UTC day on which the couple did at least one
// of these:
//   - either partner sent a location ping (locationPing.captured_at)
//   - either partner created a moment (geoMoment.created_at)
//   - either partner answered the daily prompt (dailyQuestionAnswer.created_at)
//
// Streak = number of consecutive days ending today (or yesterday — see
// `computeStreak` for the grace-day rule) on which the couple was active.
//
// The DB-backed query returns at most the last 60 days of activity so the
// streak ceiling is 60. That's deliberate: if you're 60 days in you've made
// the point, and we keep the cost bounded.

import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';

export const MAX_STREAK_LOOKBACK_DAYS = 60;

/**
 * Pure helper: given a set of UTC YYYY-MM-DD active-day keys and "today",
 * count consecutive days back. If today itself isn't active we count
 * back from yesterday (one-day grace) so the streak doesn't reset at
 * 00:00 UTC before either partner has had a chance to act.
 */
export function computeStreak(activeDays: ReadonlySet<string>, todayKey: string): number {
	let cursor = todayKey;
	let count = 0;
	let allowedSkips = 1; // grace for "today" itself

	while (true) {
		if (activeDays.has(cursor)) {
			count++;
			allowedSkips = 0; // grace consumed once we anchor a streak
		} else if (allowedSkips > 0) {
			allowedSkips--;
		} else {
			break;
		}
		cursor = prevDay(cursor);
		// Hard cap to avoid pathological loops on malformed input.
		if (count > MAX_STREAK_LOOKBACK_DAYS + 1) break;
	}
	return count;
}

function prevDay(yyyymmdd: string): string {
	const d = new Date(yyyymmdd + 'T00:00:00Z');
	d.setUTCDate(d.getUTCDate() - 1);
	return d.toISOString().slice(0, 10);
}

export type StreakView = {
	current: number;
	lastActiveDay: string | null;
};

/**
 * DB-backed: gather the union of active days across heartbeats, moments
 * and daily-prompt answers, then derive the current streak.
 *
 * One query, one round trip — the union is computed in Postgres so we
 * never pull more than ~60 rows back to the worker.
 */
export async function getStreak(coupleId: string, now: Date = new Date()): Promise<StreakView> {
	const sinceIso = new Date(now.getTime() - MAX_STREAK_LOOKBACK_DAYS * 86_400_000).toISOString();

	const rows = await db.execute<{ day: string }>(sql`
		select to_char(d, 'YYYY-MM-DD') as day from (
			select date_trunc('day', captured_at at time zone 'UTC')::date as d
				from public.location_ping
				where couple_id = ${coupleId} and captured_at >= ${sinceIso}
			union
			select date_trunc('day', created_at at time zone 'UTC')::date as d
				from public.geo_moment
				where couple_id = ${coupleId} and created_at >= ${sinceIso}
				and deleted_at is null
			union
			select date_trunc('day', dqa.created_at at time zone 'UTC')::date as d
				from public.daily_question_answer dqa
				join public.couple c on c.id = ${coupleId}
				where dqa.user_id in (c.partner_a, c.partner_b)
					and dqa.created_at >= ${sinceIso}
		) t
		order by d desc
	`);

	const activeDays = new Set<string>();
	let lastActiveDay: string | null = null;
	// drizzle's execute returns an array-like; iterate defensively.
	for (const r of rows as unknown as Array<{ day: string }>) {
		if (r?.day) {
			activeDays.add(r.day);
			if (lastActiveDay === null) lastActiveDay = r.day;
		}
	}

	const todayKey = now.toISOString().slice(0, 10);
	return { current: computeStreak(activeDays, todayKey), lastActiveDay };
}
