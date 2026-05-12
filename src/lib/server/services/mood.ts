// F5 — Mood pulse service.
//
// Five-bucket mood (joyful/happy/neutral/sad/upset) rendered as 😄😊😐😔😢
// in the UI. Append-only history; latest-per-(couple,user) drives the /pulse
// partner badge, last-N-days drives the /settings trend strip.
//
// Privacy: the partner cannot read the other partner's mood history via
// supabase-js (RLS, see drizzle/manual/0012_mood_pulse.sql). We deliver
// only the latest mood per partner to /pulse via SSR — fine because the
// product UX only needs "what is your partner feeling right now?".
//
// Anti-noise: setMood dedupes within DEDUPE_WINDOW_MS — clicking the same
// mood twice in a minute does not append a second row, which would skew
// the trend strip and inflate broadcast volume.

import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { moodPulse } from '$lib/server/db/schema';

export type Mood = 'joyful' | 'happy' | 'neutral' | 'sad' | 'upset';

export const MOODS: readonly Mood[] = ['joyful', 'happy', 'neutral', 'sad', 'upset'] as const;

export const DEDUPE_WINDOW_MS = 60_000;
export const MAX_TREND_DAYS = 60;

export function isMood(v: unknown): v is Mood {
	return typeof v === 'string' && (MOODS as readonly string[]).includes(v);
}

export interface MoodSnapshot {
	mood: Mood;
	setAt: string; // ISO
}

/** Latest mood for both partners in a couple, keyed by userId. */
export async function getLatestMoodForCouple(
	coupleId: string
): Promise<Record<string, MoodSnapshot>> {
	// `distinct on (user_id)` + ORDER BY ensures one row per user, the
	// most recent. Cheap because of mood_pulse_couple_user_idx.
	const rows = await db.execute<{ user_id: string; mood: string; set_at: string }>(sql`
		select distinct on (user_id) user_id, mood, set_at
		from mood_pulse
		where couple_id = ${coupleId}
		order by user_id, set_at desc
	`);
	const out: Record<string, MoodSnapshot> = {};
	for (const r of rows) {
		if (isMood(r.mood)) {
			out[r.user_id] = { mood: r.mood, setAt: new Date(r.set_at).toISOString() };
		}
	}
	return out;
}

/**
 * Append a mood unless the user already set the same mood within the
 * dedupe window. Returns the row that represents the user's current
 * mood — either the freshly-inserted one or the existing recent one.
 */
export async function setMood(args: {
	userId: string;
	coupleId: string;
	mood: Mood;
	now?: Date;
}): Promise<MoodSnapshot> {
	const now = args.now ?? new Date();
	const dedupeFloor = new Date(now.getTime() - DEDUPE_WINDOW_MS);

	const recent = await db
		.select({ mood: moodPulse.mood, setAt: moodPulse.setAt })
		.from(moodPulse)
		.where(
			and(
				eq(moodPulse.userId, args.userId),
				eq(moodPulse.coupleId, args.coupleId),
				gte(moodPulse.setAt, dedupeFloor)
			)
		)
		.orderBy(desc(moodPulse.setAt))
		.limit(1);

	if (recent[0] && recent[0].mood === args.mood) {
		return { mood: args.mood, setAt: recent[0].setAt.toISOString() };
	}

	const [inserted] = await db
		.insert(moodPulse)
		.values({
			userId: args.userId,
			coupleId: args.coupleId,
			mood: args.mood,
			setAt: now
		})
		.returning({ setAt: moodPulse.setAt });

	return { mood: args.mood, setAt: inserted.setAt.toISOString() };
}

export interface TrendBucket {
	/** UTC YYYY-MM-DD */
	date: string;
	/** Most recent mood set on this UTC day, or null if none. */
	mood: Mood | null;
}

/**
 * Returns one entry per UTC day in `[today - days + 1, today]`. Days with
 * no mood set are returned with `mood: null` so the UI can render a gap.
 * Cap is `MAX_TREND_DAYS` to bound query cost.
 */
export async function getMoodTrend(
	userId: string,
	days: number,
	now: Date = new Date()
): Promise<TrendBucket[]> {
	const span = Math.max(1, Math.min(MAX_TREND_DAYS, days));
	const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
	const from = new Date(today.getTime() - (span - 1) * 86_400_000);

	const rows = await db.execute<{ day: string; mood: string }>(sql`
		select distinct on (date_trunc('day', set_at at time zone 'UTC'))
			to_char(date_trunc('day', set_at at time zone 'UTC'), 'YYYY-MM-DD') as day,
			mood
		from mood_pulse
		where user_id = ${userId}
			and set_at >= ${from.toISOString()}
		order by date_trunc('day', set_at at time zone 'UTC') desc, set_at desc
	`);

	const byDay = new Map<string, Mood>();
	for (const r of rows) if (isMood(r.mood)) byDay.set(r.day, r.mood);

	const out: TrendBucket[] = [];
	for (let i = 0; i < span; i++) {
		const d = new Date(from.getTime() + i * 86_400_000);
		const key = d.toISOString().slice(0, 10);
		out.push({ date: key, mood: byDay.get(key) ?? null });
	}
	return out;
}
