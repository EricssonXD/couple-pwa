/**
 * DuoSync theme switching.
 *
 * DaisyUI 5 reads `data-theme` from `<html>`. By default the user's
 * `prefers-color-scheme` chooses between `duosync-light` and `duosync-dark`
 * (declared with `--prefersdark` in layout.css).
 *
 * Use `setTheme('duosync-dark')` per-route inside `onMount` to force a
 * specific theme (e.g. /map, /moments/new). Pair with `clearTheme()` in
 * `onDestroy` so the document returns to user-preference defaults.
 */

export type DuoSyncTheme = 'duosync-light' | 'duosync-dark';

export function setTheme(theme: DuoSyncTheme): void {
	if (typeof document === 'undefined') return;
	document.documentElement.dataset.theme = theme;
}

export function clearTheme(): void {
	if (typeof document === 'undefined') return;
	delete document.documentElement.dataset.theme;
}
