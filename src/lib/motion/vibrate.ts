/**
 * DuoSync haptic feedback helper.
 *
 * Wraps `navigator.vibrate` with a feature check so the call is a no-op
 * on platforms (most desktops, iOS Safari < 16.4) that don't support
 * the Vibration API. Patterns are arrays of millisecond on/off values.
 *
 * Common patterns are exported as named constants so callers don't
 * sprinkle magic numbers.
 */

export type VibratePattern = number | number[];

/** Single short pulse (~25 ms). For taps, toggles. */
export const TAP_LIGHT: VibratePattern = 25;

/** Double pulse (heartbeat-like). For HeartbeatZone double-tap. */
export const TAP_HEARTBEAT: VibratePattern = [30, 80, 30];

/** Long sustained buzz (~120 ms). For SOS / errors. */
export const BUZZ_ALERT: VibratePattern = 120;

/** Three-pulse celebration. For pair-success bloom. */
export const BUZZ_BLOOM: VibratePattern = [40, 40, 40, 40, 80];

/**
 * Trigger device vibration if the platform supports it AND the user
 * hasn't disabled motion (best-effort proxy via prefers-reduced-motion).
 * Returns true if the request was sent, false otherwise.
 */
export function vibrate(pattern: VibratePattern = TAP_LIGHT): boolean {
	if (typeof navigator === 'undefined' || typeof window === 'undefined') return false;
	if (!('vibrate' in navigator)) return false;

	// Respect users with reduced-motion preference — vibration is also a
	// "motion" cue and can be uncomfortable for some.
	try {
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (reduce) return false;
	} catch {
		/* matchMedia not supported — proceed */
	}

	try {
		return navigator.vibrate(pattern);
	} catch {
		return false;
	}
}
