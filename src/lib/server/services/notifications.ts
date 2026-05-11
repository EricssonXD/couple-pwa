/**
 * Push notification trigger surface (N2).
 *
 * Inserts rows into `push_outbox` for the N3 delivery worker to consume.
 * Triggers are invoked from the relevant service layers (no automatic
 * row-level postgres triggers — keeps the orchestration in TypeScript so
 * we can re-use the dedupe / rate-limit logic).
 *
 * Three triggers ship today (matches docs/next-phases.md N2):
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
	// onConflictDoNothing on the partial dedupe index means a duplicate
	// dedupe_key in the window silently no-ops. We rely on the N3 worker
	// to GC delivered rows so the index doesn't grow unbounded.
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
		.onConflictDoNothing({ target: [pushOutbox.recipientId, pushOutbox.dedupeKey] });
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

/** Test helper. */
export async function _internalDrainOutbox() {
	await db.execute(sql`DELETE FROM push_outbox`);
}
