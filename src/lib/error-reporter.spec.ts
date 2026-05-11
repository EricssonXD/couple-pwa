import { describe, it, expect, vi, afterEach } from 'vitest';
import { scrub, report } from './error-reporter';

describe('scrub', () => {
	it('redacts email addresses inside strings', () => {
		expect(scrub('contact me at ada@example.com please')).toBe('contact me at [email] please');
	});

	it('redacts JWTs inside strings', () => {
		const jwt = 'eyJhbGciOi.eyJzdWIiOiIxMjM0NSJ9.signaturepart';
		expect(scrub(`Bearer ${jwt}`)).toBe('Bearer [jwt]');
	});

	it('redacts coordinates inside strings', () => {
		expect(scrub('lat 22.31954 lng 114.16936')).toBe('lat [coord] lng [coord]');
	});

	it('redacts values under sensitive keys', () => {
		const out = scrub({
			email: 'a@b.co',
			password: 'hunter2',
			token: 'abc',
			lat: 22.3,
			lng: 114.1,
			safe: 'ok'
		}) as Record<string, unknown>;
		expect(out.email).toBe('[redacted]');
		expect(out.password).toBe('[redacted]');
		expect(out.token).toBe('[redacted]');
		expect(out.lat).toBe('[redacted]');
		expect(out.lng).toBe('[redacted]');
		expect(out.safe).toBe('ok');
	});

	it('walks Error instances and scrubs message + stack', () => {
		const err = new Error('failed for ada@example.com');
		const out = scrub(err) as { name: string; message: string; stack?: string };
		expect(out.name).toBe('Error');
		expect(out.message).toBe('failed for [email]');
		expect(out.stack).not.toContain('ada@example.com');
	});

	it('caps recursion to avoid infinite loops', () => {
		const a: Record<string, unknown> = {};
		let cur = a;
		for (let i = 0; i < 20; i++) {
			const next: Record<string, unknown> = {};
			cur.next = next;
			cur = next;
		}
		expect(() => scrub(a)).not.toThrow();
	});
});

describe('report', () => {
	const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

	afterEach(() => {
		errSpy.mockClear();
	});

	it('emits one structured JSON line and returns an id', () => {
		const result = report(new Error('boom for ada@example.com'), {
			side: 'server',
			url: '/pulse',
			route: '/pulse'
		});
		expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
		expect(errSpy).toHaveBeenCalledTimes(1);
		const payload = JSON.parse(errSpy.mock.calls[0][0] as string);
		expect(payload.id).toBe(result.id);
		expect(payload.side).toBe('server');
		expect(payload.error.message).toBe('boom for [email]');
		expect(payload.level).toBe('error');
	});
});
