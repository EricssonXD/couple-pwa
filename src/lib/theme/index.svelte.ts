/**
 * DuoSync theme switching.
 *
 * Priority (highest wins):
 *   1. User's explicit choice (persisted in localStorage as 'duosync-theme')
 *   2. Route-forced theme (declared in +layout.svelte ROUTE_THEME)
 *   3. System `prefers-color-scheme` (declared in layout.css with --prefersdark)
 *
 * The user choice ALWAYS wins over a route-forced theme — if the user
 * picks light mode in /settings, the dark-only routes (/map,
 * /moments/new) honour it. Per-route forced themes only kick in for
 * users who haven't set a preference.
 *
 * DaisyUI 5 reads `data-theme` from `<html>`. We write it directly via
 * `applyDom()`; a tiny Svelte rune-backed store (`themeState`) lets
 * other components reactively pick the effective theme (e.g. /map
 * swapping its tile layer when theme changes).
 */

import { browser } from '$app/environment';

export type DuoSyncTheme = 'duosync-light' | 'duosync-dark';
export type ThemeChoice = 'auto' | DuoSyncTheme;

const STORAGE_KEY = 'duosync-theme';

function readStored(): DuoSyncTheme | null {
	if (!browser) return null;
	try {
		const v = localStorage.getItem(STORAGE_KEY);
		return v === 'duosync-light' || v === 'duosync-dark' ? v : null;
	} catch {
		return null;
	}
}

function readSystem(): DuoSyncTheme {
	if (!browser) return 'duosync-light';
	return window.matchMedia('(prefers-color-scheme: dark)').matches
		? 'duosync-dark'
		: 'duosync-light';
}

// Reactive runes-backed store. Components that need to react to theme
// changes (e.g. /map's tile layer) import and read `themeState.effective`.
class ThemeState {
	user = $state<DuoSyncTheme | null>(null);
	route = $state<DuoSyncTheme | null>(null);
	system = $state<DuoSyncTheme>('duosync-light');
	effective = $derived<DuoSyncTheme>(this.user ?? this.route ?? this.system);
}

export const themeState = new ThemeState();

/**
 * Initialise the store + apply the current theme to <html>. Safe to
 * call on every layout mount; subsequent calls just re-sync.
 *
 * Wires a `prefers-color-scheme` change listener so auto-mode tracks
 * the OS theme live. Returns a cleanup function for onDestroy.
 */
export function initTheme(): () => void {
	if (!browser) return () => {};
	themeState.user = readStored();
	themeState.system = readSystem();
	applyDom(themeState.effective);

	const mq = window.matchMedia('(prefers-color-scheme: dark)');
	const onSystemChange = () => {
		themeState.system = readSystem();
		applyDom(themeState.effective);
	};
	mq.addEventListener('change', onSystemChange);
	return () => mq.removeEventListener('change', onSystemChange);
}

/** Set the route-forced theme (called from +layout.svelte). */
export function setRouteTheme(theme: DuoSyncTheme | null): void {
	if (!browser) return;
	themeState.route = theme;
	applyDom(themeState.effective);
}

/** User picks an explicit theme in /settings. Persists + applies. */
export function setUserTheme(choice: ThemeChoice): void {
	if (!browser) return;
	if (choice === 'auto') {
		try {
			localStorage.removeItem(STORAGE_KEY);
		} catch {
			/* ignore */
		}
		themeState.user = null;
	} else {
		try {
			localStorage.setItem(STORAGE_KEY, choice);
		} catch {
			/* ignore */
		}
		themeState.user = choice;
	}
	applyDom(themeState.effective);
}

/** Read the user's stored choice for UI display. */
export function getUserChoice(): ThemeChoice {
	return themeState.user ?? 'auto';
}

function applyDom(theme: DuoSyncTheme): void {
	if (typeof document === 'undefined') return;
	document.documentElement.dataset.theme = theme;
}

// ──────────────────────────────────────────────────────────────────────
// All public exports are above. Legacy setTheme()/clearTheme() shims
// were removed in U8 cleanup — callers should use setRouteTheme(...)
// from +layout.svelte and setUserTheme(...) from settings instead.
// ──────────────────────────────────────────────────────────────────────
