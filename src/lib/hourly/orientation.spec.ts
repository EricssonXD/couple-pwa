import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readOrientation, onOrientationChange } from './orientation';

describe('readOrientation', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('returns landscape when screen.orientation.type starts with "landscape"', () => {
		vi.stubGlobal('window', {
			screen: { orientation: { type: 'landscape-primary' } },
			matchMedia: () => ({ matches: false })
		});
		expect(readOrientation()).toBe('landscape');
	});

	it('returns portrait when screen.orientation reports portrait', () => {
		vi.stubGlobal('window', {
			screen: { orientation: { type: 'portrait-primary' } },
			matchMedia: () => ({ matches: true })
		});
		expect(readOrientation()).toBe('portrait');
	});

	it('falls back to matchMedia when screen.orientation is missing', () => {
		vi.stubGlobal('window', {
			screen: {},
			matchMedia: (q: string) => ({ matches: q.includes('landscape') })
		});
		expect(readOrientation()).toBe('landscape');
	});

	it('returns portrait when window is undefined (SSR)', () => {
		vi.stubGlobal('window', undefined);
		expect(readOrientation()).toBe('portrait');
	});
});

describe('onOrientationChange', () => {
	beforeEach(() => {
		vi.unstubAllGlobals();
	});

	it('subscribes to screen.orientation change events and returns unsubscribe', () => {
		const handlers: Array<() => void> = [];
		const add = vi.fn((_e: string, h: () => void) => {
			handlers.push(h);
		});
		const remove = vi.fn();
		vi.stubGlobal('window', {
			screen: {
				orientation: {
					type: 'portrait-primary',
					addEventListener: add,
					removeEventListener: remove
				}
			},
			matchMedia: () => ({ matches: false })
		});
		const cb = vi.fn();
		const off = onOrientationChange(cb);
		expect(add).toHaveBeenCalledWith('change', expect.any(Function));
		handlers[0]?.();
		expect(cb).toHaveBeenCalledWith('portrait');
		off();
		expect(remove).toHaveBeenCalled();
	});

	it('falls back to matchMedia subscription', () => {
		const add = vi.fn();
		const remove = vi.fn();
		const mql = { matches: false, addEventListener: add, removeEventListener: remove };
		vi.stubGlobal('window', {
			screen: {},
			matchMedia: () => mql
		});
		const cb = vi.fn();
		const off = onOrientationChange(cb);
		expect(add).toHaveBeenCalledWith('change', expect.any(Function));
		off();
		expect(remove).toHaveBeenCalled();
	});

	it('is a no-op when window is undefined', () => {
		vi.stubGlobal('window', undefined);
		expect(() => onOrientationChange(() => {})()).not.toThrow();
	});
});
