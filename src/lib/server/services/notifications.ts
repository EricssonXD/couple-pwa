/**
 * Push notification trigger surface (N2).
 *
 * Inserts rows into `push_outbox` for the N3 delivery worker to consume.
 * Triggers are invoked from the relevant service layers (no automatic
 * row-level postgres triggers — keeps the orchestration in TypeScript so
 * we can re-use the dedupe / rate-limit logic).
 *
 * Three triggers ship today (N2 trigger taxonomy):
 *   - notifyMomentDroppedNearby — partner authors a moment within reach
 *   - notifyLowBattery — partner battery just crossed below 15%
 *   - notifyPartnerArrived — partner entered a saved place radius
 *     (no-op until G1/G2 ship the saved-places UX; the function is
 *     wired so the future place-detector can call it directly)
 *
 * Skipped silently when the recipient is ghosted — leaks presence.
 */
import { sql } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { profile, pushOutbox } from '$lib/server/db/app.schema';
import { eq } from 'drizzle-orm';
import { isGhostActive } from './location';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';

const LOW_BATTERY_THRESHOLD = 15;
// Suppress repeat low-battery pings for an hour even if battery dips
// back above and below the threshold (jitter from charging cycles).
const LOW_BATTERY_DEDUPE_WINDOW_HOURS = 1;
// Suppress repeat moment-nearby pings for the same moment id.
const MOMENT_NEARBY_DEDUPE_WINDOW_HOURS = 24;

async function recipientGhosted(userId: string): Promise<boolean> {
	const [p] = await db
		.select({ ghostMode: profile.ghostMode, ghostUntil: profile.ghostUntil })
		.from(profile)
		.where(eq(profile.userId, userId))
		.limit(1);
	if (!p) return false;
	return isGhostActive(p.ghostMode, p.ghostUntil);
}

interface EnqueueArgs {
	coupleId: string;
	recipientId: string;
	kind: string;
	title: string;
	body: string;
	data?: Record<string, unknown>;
	dedupeKey?: string;
}

async function enqueue(args: EnqueueArgs): Promise<void> {
	if (await recipientGhosted(args.recipientId)) return;
	const dataJson = args.data ? JSON.stringify(args.data) : null;
	// Partial unique index on (recipient_id, dedupe_key) WHERE
	// dedupe_key IS NOT NULL. Postgres requires the same predicate on
	// the ON CONFLICT to use a partial index — the `where` clause below
	// matches drizzle/manual/0010_push_outbox.sql:31. Without it the
	// planner errors with 42P10 "no unique or exclusion constraint
	// matching the ON CONFLICT specification".
	await db
		.insert(pushOutbox)
		.values({
			coupleId: args.coupleId,
			recipientId: args.recipientId,
			kind: args.kind,
			title: args.title,
			body: args.body,
			dataJson,
			dedupeKey: args.dedupeKey ?? null
		})
		.onConflictDoNothing({
			target: [pushOutbox.recipientId, pushOutbox.dedupeKey],
			where: sql`${pushOutbox.dedupeKey} IS NOT NULL`
		});

	// Fire-and-forget kick to push-deliver so the notification arrives in
	// seconds instead of waiting up to a minute for the next pg_cron tick.
	// Cron stays scheduled as a backstop for the no-context / network-fail
	// case (and to drain rows that were inserted in scripts / tests).
	maybeKickPushDeliver();
}

/**
 * Pure helper, exported for tests. Returns true iff a kick was scheduled.
 *
 * Schedules an HTTP POST to the push-deliver edge function via the
 * provided `waitUntil` (so it survives past the response on Cloudflare
 * Workers) or, when no waitUntil is available, fires it untracked and
 * relies on the runtime to keep the promise alive long enough.
 */
export function kickPushDeliver(
	url: string | undefined,
	token: string | undefined,
	fetcher: typeof fetch,
	waitUntil: ((p: Promise<unknown>) => void) | undefined
): boolean {
	if (!url || !token) return false;
	const startedAt = Date.now();
	const p = fetcher(url, {
		method: 'POST',
		headers: { authorization: `Bearer ${token}` }
	})
		.then((res) => {
			// One-line structured log per kick. Grep `push-deliver kick`
			// in Cloudflare Worker logs to verify the inline path is firing
			// in prod and to check the round-trip latency.
			console.log(`push-deliver kick status=${res.status} ms=${Date.now() - startedAt}`);
			return res;
		})
		.catch((e) => {
			// Best-effort. The pg_cron schedule will retry on its next tick.
			console.error('push-deliver kick failed', e);
			return undefined;
		});
	if (waitUntil) waitUntil(p);
	else void p;
	return true;
}

function maybeKickPushDeliver(): void {
	let event: ReturnType<typeof getRequestEvent> | undefined;
	try {
		event = getRequestEvent();
	} catch {
		// Outside a request scope (cron self-invocation, scripts, tests).
		// No worker context → nothing to schedule against.
		return;
	}
	const platform = event.platform as
		| { context?: { waitUntil?: (p: Promise<unknown>) => void } }
		| undefined;
	const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
	kickPushDeliver(env.PUSH_DELIVER_URL, env.CRON_TOKEN, fetch, waitUntil);
}

export interface MomentNearbyTrigger {
	coupleId: string;
	recipientId: string;
	momentId: string;
	authorDisplayName: string | null;
	distanceM: number;
}

/**
 * Partner authored a moment within `radiusM + recipient_accuracy` of
 * the recipient's last known fix. Caller is responsible for proximity
 * detection — this just enqueues. Dedupes per (recipient, momentId)
 * for 24h so re-broadcasts (e.g. moment_updated) don't re-notify.
 */
export async function notifyMomentDroppedNearby(t: MomentNearbyTrigger): Promise<void> {
	const name = t.authorDisplayName ?? 'Your partner';
	await enqueue({
		coupleId: t.coupleId,
		recipientId: t.recipientId,
		kind: 'partner_dropped_moment',
		title: `${name} left you something nearby`,
		body: `About ${Math.round(t.distanceM)}m away — go take a look.`,
		data: { momentId: t.momentId, kind: 'partner_dropped_moment' },
		dedupeKey: `moment_nearby:${t.momentId}:${windowBucket(MOMENT_NEARBY_DEDUPE_WINDOW_HOURS)}`
	});
}

export interface LowBatteryTrigger {
	coupleId: string;
	recipientId: string;
	authorDisplayName: string | null;
	batteryPct: number;
	charging: boolean;
	priorBatteryPct: number | null;
}

/**
 * Partner battery dropped below 15% on this ping. Skipped if they're
 * charging (about to recover) or if we already notified within the
 * dedupe window. Edge-triggered: requires the prior ping's battery to
 * have been above the threshold (or unknown).
 */
export async function notifyLowBattery(t: LowBatteryTrigger): Promise<void> {
	if (t.charging) return;
	if (t.batteryPct >= LOW_BATTERY_THRESHOLD) return;
	if (t.priorBatteryPct !== null && t.priorBatteryPct < LOW_BATTERY_THRESHOLD) return;
	const name = t.authorDisplayName ?? 'Your partner';
	await enqueue({
		coupleId: t.coupleId,
		recipientId: t.recipientId,
		kind: 'partner_low_battery',
		title: `${name}'s phone is low`,
		body: `${Math.round(t.batteryPct)}% battery — they might drop off soon.`,
		data: { kind: 'partner_low_battery' },
		dedupeKey: `low_battery:${windowBucket(LOW_BATTERY_DEDUPE_WINDOW_HOURS)}`
	});
}

export interface PartnerArrivedTrigger {
	coupleId: string;
	recipientId: string;
	authorDisplayName: string | null;
	placeName: string;
	placeId: string;
}

/**
 * Partner entered a saved place radius. Wired for the future
 * saved-places feature — currently no caller, but kept here so the
 * trigger surface is complete and tested for N2.
 */
export async function notifyPartnerArrived(t: PartnerArrivedTrigger): Promise<void> {
	const name = t.authorDisplayName ?? 'Your partner';
	await enqueue({
		coupleId: t.coupleId,
		recipientId: t.recipientId,
		kind: 'partner_arrived',
		title: `${name} just arrived at ${t.placeName}`,
		body: '',
		data: { placeId: t.placeId, kind: 'partner_arrived' },
		// One arrival event per place per hour — re-entry-flapping
		// shouldn't notify repeatedly.
		dedupeKey: `arrived:${t.placeId}:${windowBucket(1)}`
	});
}

function windowBucket(hours: number): string {
	const now = Date.now();
	return String(Math.floor(now / (hours * 60 * 60 * 1000)));
}

export interface HeartbeatTapTrigger {
	coupleId: string;
	recipientId: string;
	authorDisplayName: string | null;
}

/**
 * Partner double-tapped the heartbeat zone. Dedupes per-minute so a
 * burst of taps doesn't fan out to N pushes.
 */
export async function notifyHeartbeatTap(t: HeartbeatTapTrigger): Promise<void> {
	const name = t.authorDisplayName ?? 'Your partner';
	await enqueue({
		coupleId: t.coupleId,
		recipientId: t.recipientId,
		kind: 'partner_heartbeat_tap',
		title: `${name} tapped you`,
		body: '',
		data: { kind: 'partner_heartbeat_tap' },
		dedupeKey: `tap:${windowBucket(1 / 60)}`
	});
}

export interface QuizCompletedTrigger {
	coupleId: string;
	recipientId: string;
	runId: string;
	quizTitle: string;
	finisherDisplayName: string | null;
}

/**
 * Both partners just finished a "How well do you know me?" run. Sent
 * only to the partner who was waiting (the second submitter is already
 * in-app and will see the reveal immediately). Dedupe key includes
 * runId + recipientId so a redundant call cannot fan out.
 */
export async function notifyQuizCompleted(t: QuizCompletedTrigger): Promise<void> {
	const name = t.finisherDisplayName ?? 'Your partner';
	await enqueue({
		coupleId: t.coupleId,
		recipientId: t.recipientId,
		kind: 'quiz_complete',
		title: `${name} finished your quiz`,
		body: `See how well you scored on ${t.quizTitle}.`,
		data: { kind: 'quiz_complete', runId: t.runId },
		dedupeKey: `quiz_complete:${t.runId}:${t.recipientId}`
	});
}

/** Test helper. */
export async function _internalDrainOutbox() {
	await db.execute(sql`DELETE FROM push_outbox`);
}
