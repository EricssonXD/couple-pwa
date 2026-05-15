import { afterEach, describe, expect, it, vi } from 'vitest';
import { HourlyRecorderError, pickSupportedMime } from './recorder';

describe('pickSupportedMime', () => {
	const originalMR = (globalThis as { MediaRecorder?: unknown }).MediaRecorder;

	afterEach(() => {
		(globalThis as { MediaRecorder?: unknown }).MediaRecorder = originalMR;
	});

	it('returns null when MediaRecorder is unavailable', () => {
		(globalThis as { MediaRecorder?: unknown }).MediaRecorder = undefined;
		expect(pickSupportedMime()).toBeNull();
	});

	it('prefers vp9 webm when supported', () => {
		(globalThis as { MediaRecorder?: unknown }).MediaRecorder = {
			isTypeSupported: vi.fn(() => true)
		};
		const picked = pickSupportedMime();
		expect(picked?.recorderMime).toBe('video/webm;codecs=vp9,opus');
		expect(picked?.uploadMime).toBe('video/webm');
	});

	it('falls through to mp4 when only mp4 is supported', () => {
		(globalThis as { MediaRecorder?: unknown }).MediaRecorder = {
			isTypeSupported: vi.fn((m: string) => m === 'video/mp4')
		};
		const picked = pickSupportedMime();
		expect(picked?.recorderMime).toBe('video/mp4');
		expect(picked?.uploadMime).toBe('video/mp4');
	});

	it('returns null when nothing in the allow-list is supported', () => {
		(globalThis as { MediaRecorder?: unknown }).MediaRecorder = {
			isTypeSupported: vi.fn(() => false)
		};
		expect(pickSupportedMime()).toBeNull();
	});
});

describe('HourlyRecorderError', () => {
	it('preserves the code and is instanceof Error', () => {
		const e = new HourlyRecorderError('permission_denied');
		expect(e).toBeInstanceOf(Error);
		expect(e.code).toBe('permission_denied');
	});
});
