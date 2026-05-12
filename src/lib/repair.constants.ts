// Constants for F16 repair sessions — kept client+server reachable so
// the route's countdown UI and the service's validation share a
// single source of truth.

export const REPAIR_NOTE_MAX_LEN = 1000;

// Minimum cooldown is 5 minutes; maximum is 24 hours. The default
// (20 min) lands in the "long enough to breathe, short enough to keep
// momentum" range from John Gottman's repair-attempt research.
export const REPAIR_COOLDOWN_MIN_MS = 5 * 60_000;
export const REPAIR_COOLDOWN_MAX_MS = 24 * 60 * 60_000;
export const REPAIR_COOLDOWN_DEFAULT_MS = 20 * 60_000;

// Status values mirror the table CHECK constraint; client uses these
// for narrowing.
export const REPAIR_STATUSES = ['cooldown', 'reflecting', 'completed', 'cancelled'] as const;
export type RepairStatus = (typeof REPAIR_STATUSES)[number];
