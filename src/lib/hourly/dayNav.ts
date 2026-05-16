// Pure helpers for the /hourly pager. No DOM, no Svelte, no I/O.
//
// `hour bucket` strings are ISO timestamps already truncated to the
// hour boundary in UTC (e.g. `2026-05-16T18:00:00Z`) — the canonical
// shape returned by /api/hourly/day and stored in `hourly_clip.hour_bucket`.

export const HOUR_MS = 60 * 60 * 1000;

/**
 * Truncate a Date to its UTC hour boundary and emit the canonical
 * bucket ISO string used everywhere in F11.
 */
export function bucketOf(d: Date): string {
	const utc = new Date(
		Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), 0, 0, 0)
	);
	return utc.toISOString().replace('.000Z', 'Z');
}

/** Current hour bucket (UTC), driven by `now`. */
export function currentBucket(now: Date = new Date()): string {
	return bucketOf(now);
}

export function prevHour(bucket: string): string {
	return bucketOf(new Date(new Date(bucket).getTime() - HOUR_MS));
}

export function nextHour(bucket: string): string {
	return bucketOf(new Date(new Date(bucket).getTime() + HOUR_MS));
}

/** True if `bucket` is strictly after the current hour. */
export function isFuture(bucket: string, now: Date = new Date()): boolean {
	return new Date(bucket).getTime() > new Date(currentBucket(now)).getTime();
}

/** True if `bucket` equals the current hour. */
export function isCurrentHour(bucket: string, now: Date = new Date()): boolean {
	return bucket === currentBucket(now);
}

/**
 * Render a hour bucket as the user's local "h AM/PM" label, e.g.
 * `3:00 PM` (en) or `下午3:00` (zh-Hant). The bucket is UTC; output
 * uses the user's local tz.
 */
export function hourLabel(bucket: string, locale = 'en', tz?: string): string {
	const d = new Date(bucket);
	return new Intl.DateTimeFormat(locale, {
		hour: 'numeric',
		minute: '2-digit',
		hour12: locale.startsWith('en'),
		timeZone: tz
	}).format(d);
}

/**
 * Short relative label vs `now` (e.g. "now", "3h ago", "yesterday").
 * Used in the hour pager bar to give context without burying the user
 * in a full timestamp. Returns a structured value so the caller can
 * decide how to i18n it.
 */
export type RelativeLabel =
	| { kind: 'now' }
	| { kind: 'hours_ago'; n: number }
	| { kind: 'yesterday' }
	| { kind: 'days_ago'; n: number }
	| { kind: 'future' };

export function relativeLabel(bucket: string, now: Date = new Date()): RelativeLabel {
	const diffMs = new Date(currentBucket(now)).getTime() - new Date(bucket).getTime();
	if (diffMs < 0) return { kind: 'future' };
	const diffHours = Math.round(diffMs / HOUR_MS);
	if (diffHours === 0) return { kind: 'now' };
	if (diffHours < 24) return { kind: 'hours_ago', n: diffHours };
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays === 1) return { kind: 'yesterday' };
	return { kind: 'days_ago', n: diffDays };
}

/**
 * Resolve which hour bucket the pager should display when the page
 * first loads (or when the user navigates with no explicit selection).
 *
 * Rules:
 *  - If the caller passed an explicit `selected`, use it.
 *  - Else snap to the current hour.
 *  - Never return a future bucket.
 */
export function deriveSelectedHour(opts: {
	selected?: string | null;
	now?: Date;
}): string {
	const now = opts.now ?? new Date();
	const current = currentBucket(now);
	if (!opts.selected) return current;
	return isFuture(opts.selected, now) ? current : opts.selected;
}
