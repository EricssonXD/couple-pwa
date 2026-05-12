// Shared client+server constants for F3 time capsules.
// Server module src/lib/server/services/scheduledNotes.ts re-exports these.
export const MIN_LEAD_TIME_MS = 5 * 60_000;
export const MAX_LEAD_TIME_MS = 10 * 365 * 86_400_000;
export const MAX_BODY_LEN = 2000;
export const MAX_PENDING_PER_AUTHOR = 100;
