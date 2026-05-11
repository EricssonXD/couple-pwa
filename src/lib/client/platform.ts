/**
 * iOS / standalone-PWA detection (N4).
 *
 * iOS Safari only allows Web Push for sites that are installed to the
 * home screen and opened in standalone mode (since iOS 16.4). We need
 * to detect:
 *   - Is this an iOS device?
 *   - Are we currently running standalone (added-to-home-screen)?
 *   - Is the iOS version new enough?
 *
 * to render the right CTA in the push card. Android / desktop just
 * skip the iOS hint entirely.
 */

export interface PlatformInfo {
	isIOS: boolean;
	// iPad on iOS 13+ reports as Mac in UA. Detect via touch + platform.
	isIPadOS: boolean;
	// Running as an installed PWA (display-mode: standalone or
	// navigator.standalone on Safari).
	isStandalone: boolean;
	// Parsed major.minor for iOS version gating (16.4 minimum for push).
	iosVersion: { major: number; minor: number } | null;
}

export interface PlatformInput {
	userAgent: string;
	platform: string;
	maxTouchPoints: number;
	standaloneNavigator: boolean | undefined;
	standaloneMatchMedia: boolean;
}

export function detectPlatformFrom(input: PlatformInput): PlatformInfo {
	const ua = input.userAgent;
	const isIPhoneIPod = /iPhone|iPod/.test(ua);
	const isIPadOS = /iPad/.test(ua) || (input.platform === 'MacIntel' && input.maxTouchPoints > 1);
	const isIOS = isIPhoneIPod || isIPadOS;

	let iosVersion: PlatformInfo['iosVersion'] = null;
	if (isIOS) {
		const m = ua.match(/OS (\d+)_(\d+)(?:_(\d+))?/);
		if (m) iosVersion = { major: parseInt(m[1], 10), minor: parseInt(m[2], 10) };
	}

	const isStandalone = input.standaloneMatchMedia || input.standaloneNavigator === true;
	return { isIOS, isIPadOS, isStandalone, iosVersion };
}

export function detectPlatform(): PlatformInfo {
	if (typeof window === 'undefined' || typeof navigator === 'undefined') {
		return { isIOS: false, isIPadOS: false, isStandalone: false, iosVersion: null };
	}
	return detectPlatformFrom({
		userAgent: navigator.userAgent,
		platform: navigator.platform ?? 'unknown',
		maxTouchPoints: typeof navigator.maxTouchPoints === 'number' ? navigator.maxTouchPoints : 0,
		standaloneNavigator: (navigator as unknown as { standalone?: boolean }).standalone,
		standaloneMatchMedia:
			typeof window.matchMedia === 'function' &&
			window.matchMedia('(display-mode: standalone)').matches
	});
}

/**
 * Whether iOS push is *eligible* to be enabled (correct OS + standalone).
 * Returns the reason string when not — so the UI can render the right hint.
 */
export function iosPushEligibility(p: PlatformInfo):
	| { ok: true }
	| {
			ok: false;
			reason: 'not_ios' | 'too_old' | 'not_standalone';
	  } {
	if (!p.isIOS) return { ok: false, reason: 'not_ios' };
	if (
		!p.iosVersion ||
		p.iosVersion.major < 16 ||
		(p.iosVersion.major === 16 && p.iosVersion.minor < 4)
	) {
		return { ok: false, reason: 'too_old' };
	}
	if (!p.isStandalone) return { ok: false, reason: 'not_standalone' };
	return { ok: true };
}
