// iOS install-hint helpers.
//
// Safari on iOS does not fire `beforeinstallprompt`, so the only way to
// install a PWA on iPhone/iPad is the manual Share → Add to Home Screen
// flow. These helpers detect when the hint is appropriate and persist
// dismissal so we don't nag.
//
// Non-Safari iOS browsers (Chrome/CriOS, Firefox/FxiOS, Edge/EdgiOS)
// share Apple's WebKit but do not expose the "Add to Home Screen"
// menu entry. For those we surface a different message: open in Safari.

const DISMISS_KEY = 'duosync.ios-install.dismissed-at';
const NAG_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // a week

export type IosInstallMode = 'safari' | 'non-safari' | null;

function isIosDevice(): boolean {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent;
	const isIos = /iPad|iPhone|iPod/.test(ua);
	// iPadOS 13+ reports as Mac in the UA but exposes touch; treat as iOS.
	const isIpadOS =
		navigator.platform === 'MacIntel' &&
		(navigator as unknown as { maxTouchPoints?: number }).maxTouchPoints! > 1;
	return (isIos || isIpadOS) && !(window as unknown as { MSStream?: unknown }).MSStream;
}

function isStandalone(): boolean {
	if (typeof window === 'undefined') return false;
	return (
		window.matchMedia('(display-mode: standalone)').matches ||
		(window.navigator as unknown as { standalone?: boolean }).standalone === true
	);
}

function isSafari(): boolean {
	if (typeof navigator === 'undefined') return false;
	const ua = navigator.userAgent;
	return /^((?!chrome|android|crios|fxios|edgios).)*safari/i.test(ua);
}

/**
 * Returns the appropriate hint mode for the current iOS context, or
 * null if the hint should not be shown (already installed, dismissed
 * recently, or non-iOS device).
 */
export function iosInstallMode(): IosInstallMode {
	if (typeof window === 'undefined') return null;
	if (!isIosDevice()) return null;
	if (isStandalone()) return null;

	try {
		const dismissedAt = Number(localStorage.getItem(DISMISS_KEY) ?? 0);
		if (dismissedAt && Date.now() - dismissedAt < NAG_INTERVAL_MS) return null;
	} catch {
		// localStorage unavailable (e.g., Safari private mode) — show anyway
	}

	return isSafari() ? 'safari' : 'non-safari';
}

/** Persist dismissal so we don't surface the hint again for a week. */
export function dismissIosInstallHint(): void {
	try {
		localStorage.setItem(DISMISS_KEY, String(Date.now()));
	} catch {
		/* localStorage unavailable — best-effort only */
	}
}

/** Clear dismissal. Used by /settings "show install instructions again". */
export function resetIosInstallHint(): void {
	try {
		localStorage.removeItem(DISMISS_KEY);
	} catch {
		/* swallow */
	}
}
