import { describe, it, expect } from 'vitest';
import { detectPlatformFrom, iosPushEligibility } from './platform';

const IPHONE_16_4 =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 16_4 like Mac OS X) AppleWebKit/605.1.15 Version/16.4 Mobile/15E148 Safari/604.1';
const IPHONE_15_7 =
	'Mozilla/5.0 (iPhone; CPU iPhone OS 15_7 like Mac OS X) AppleWebKit/605.1.15 Version/15.6 Mobile/15E148 Safari/604.1';
const IPADOS_AS_MAC =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Version/16.4 Safari/605.1.15';
const ANDROID_CHROME =
	'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36';

describe('platform detection', () => {
	it('iPhone iOS 16.4 standalone is eligible', () => {
		const p = detectPlatformFrom({
			userAgent: IPHONE_16_4,
			platform: 'iPhone',
			maxTouchPoints: 5,
			standaloneNavigator: true,
			standaloneMatchMedia: false
		});
		expect(p.isIOS).toBe(true);
		expect(p.isStandalone).toBe(true);
		expect(p.iosVersion).toEqual({ major: 16, minor: 4 });
		expect(iosPushEligibility(p)).toEqual({ ok: true });
	});

	it('iOS 16.4 not-installed is not_standalone', () => {
		const p = detectPlatformFrom({
			userAgent: IPHONE_16_4,
			platform: 'iPhone',
			maxTouchPoints: 5,
			standaloneNavigator: false,
			standaloneMatchMedia: false
		});
		expect(p.isStandalone).toBe(false);
		expect(iosPushEligibility(p)).toEqual({ ok: false, reason: 'not_standalone' });
	});

	it('iOS 15 standalone is too_old', () => {
		const p = detectPlatformFrom({
			userAgent: IPHONE_15_7,
			platform: 'iPhone',
			maxTouchPoints: 5,
			standaloneNavigator: true,
			standaloneMatchMedia: false
		});
		expect(iosPushEligibility(p)).toEqual({ ok: false, reason: 'too_old' });
	});

	it('iPadOS reports via touch + Mac platform', () => {
		const p = detectPlatformFrom({
			userAgent: IPADOS_AS_MAC,
			platform: 'MacIntel',
			maxTouchPoints: 5,
			standaloneNavigator: undefined,
			standaloneMatchMedia: false
		});
		expect(p.isIPadOS).toBe(true);
		expect(p.isIOS).toBe(true);
	});

	it('Android Chrome is not_ios', () => {
		const p = detectPlatformFrom({
			userAgent: ANDROID_CHROME,
			platform: 'Linux armv8l',
			maxTouchPoints: 5,
			standaloneNavigator: undefined,
			standaloneMatchMedia: false
		});
		expect(p.isIOS).toBe(false);
		expect(iosPushEligibility(p)).toEqual({ ok: false, reason: 'not_ios' });
	});

	it('display-mode standalone alone counts as installed', () => {
		const p = detectPlatformFrom({
			userAgent: ANDROID_CHROME,
			platform: 'Linux armv8l',
			maxTouchPoints: 5,
			standaloneNavigator: undefined,
			standaloneMatchMedia: true
		});
		expect(p.isStandalone).toBe(true);
	});
});
