// F11 U3 — orientation helpers for the hourly recorder.
//
// `screen.orientation` is the modern API; Safari iOS only got it in 16.4
// so we provide a fallback via `window.matchMedia('(orientation:
// landscape)')`. Both expose a change event the caller can subscribe to.
//
// Pure browser code; SSR-safe because every access is guarded behind a
// `typeof window` check and the callers only invoke this from `$effect`.

export type Orientation = 'portrait' | 'landscape';

export function readOrientation(): Orientation {
	if (typeof window === 'undefined') return 'portrait';
	const s = window.screen?.orientation?.type;
	if (typeof s === 'string') {
		return s.startsWith('landscape') ? 'landscape' : 'portrait';
	}
	if (typeof window.matchMedia === 'function') {
		return window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait';
	}
	return 'portrait';
}

/**
 * Subscribe to orientation changes. Returns an unsubscribe function so
 * callers can use this from a Svelte `$effect`:
 *
 *   $effect(() => onOrientationChange((o) => orientation = o));
 */
export function onOrientationChange(cb: (next: Orientation) => void): () => void {
	if (typeof window === 'undefined') return () => {};
	const screenOrient = window.screen?.orientation;
	if (screenOrient && typeof screenOrient.addEventListener === 'function') {
		const handler = () => cb(readOrientation());
		screenOrient.addEventListener('change', handler);
		return () => screenOrient.removeEventListener('change', handler);
	}
	if (typeof window.matchMedia === 'function') {
		const mql = window.matchMedia('(orientation: landscape)');
		const handler = () => cb(readOrientation());
		mql.addEventListener('change', handler);
		return () => mql.removeEventListener('change', handler);
	}
	return () => {};
}
