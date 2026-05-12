// Shared client+server constants for F8 v2 calendar reminders.
//
// Kept tiny on purpose — the kinds are an enum + an offset table. The
// horizon is how far ahead `populateForEvent` will walk a recurring
// rule when seeding rows. Anything past the horizon is filled by a
// future top-up cron (or the next event mutation).

export const REMINDER_HORIZON_DAYS = 30;
export const REMINDER_HORIZON_MS = REMINDER_HORIZON_DAYS * 86_400_000;

export const REMINDER_KINDS = ['h24', 'h1'] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const REMINDER_OFFSET_MS: Readonly<Record<ReminderKind, number>> = {
	h24: 24 * 3_600_000,
	h1: 1 * 3_600_000
};

// Hard cap on rows produced by a single populateForEvent call. Mirrors
// MAX_OCCURRENCES_PER_EXPAND in services/recurrence.ts: 200 occurrences
// × 2 kinds = 400 max.
export const MAX_REMINDERS_PER_POPULATE = 400;
