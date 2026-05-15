import { describe, expect, it } from 'vitest';
import { deriveMoodState } from './pet-state';

describe('deriveMoodState', () => {
	it('returns "fine" when mood is high and belly is full (low hunger)', () => {
		expect(deriveMoodState(80, 10)).toBe('fine');
		expect(deriveMoodState(70, 30)).toBe('fine');
		expect(deriveMoodState(100, 0)).toBe('fine');
	});

	it('returns "peckish" when hunger is in the 30–60 mid-band', () => {
		expect(deriveMoodState(80, 31)).toBe('peckish');
		expect(deriveMoodState(80, 59)).toBe('peckish');
		// peckish wins over sleepy when both could apply (mood 50, hunger 50)
		expect(deriveMoodState(50, 50)).toBe('peckish');
	});

	it('returns "sleepy" when mood dips but hunger stays low', () => {
		expect(deriveMoodState(50, 10)).toBe('sleepy');
		expect(deriveMoodState(40, 25)).toBe('sleepy');
		// boundary: mood 69, hunger 29 → still not "fine"
		expect(deriveMoodState(69, 29)).toBe('sleepy');
	});

	it('returns "resting" when mood floors or hunger ceilings (severity wins)', () => {
		expect(deriveMoodState(20, 80)).toBe('resting');
		expect(deriveMoodState(30, 10)).toBe('resting');
		expect(deriveMoodState(80, 60)).toBe('resting');
		// resting takes precedence over peckish
		expect(deriveMoodState(80, 70)).toBe('resting');
	});
});
