import { describe, it, expect, vi } from 'vitest';
import { kickPushDeliver } from './notifications';

describe('kickPushDeliver — push-deliver inline trigger', () => {
	const URL = 'https://example.functions.supabase.co/push-deliver';
	const TOKEN = 't0k3n';

	it('returns false (no kick) when URL is missing', () => {
		const fetcher = vi.fn(() => Promise.resolve(new Response()));
		const waitUntil = vi.fn();
		expect(kickPushDeliver(undefined, TOKEN, fetcher as unknown as typeof fetch, waitUntil)).toBe(
			false
		);
		expect(fetcher).not.toHaveBeenCalled();
		expect(waitUntil).not.toHaveBeenCalled();
	});

	it('returns false (no kick) when token is missing', () => {
		const fetcher = vi.fn(() => Promise.resolve(new Response()));
		expect(kickPushDeliver(URL, undefined, fetcher as unknown as typeof fetch, undefined)).toBe(
			false
		);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('POSTs to the URL with a Bearer authorization header', () => {
		const fetcher = vi.fn(() => Promise.resolve(new Response()));
		const ok = kickPushDeliver(URL, TOKEN, fetcher as unknown as typeof fetch, undefined);
		expect(ok).toBe(true);
		expect(fetcher).toHaveBeenCalledTimes(1);
		const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
		expect(url).toBe(URL);
		expect(init.method).toBe('POST');
		const auth = (init.headers as Record<string, string>).authorization;
		expect(auth).toBe(`Bearer ${TOKEN}`);
	});

	it('hands the in-flight promise to waitUntil so it survives the response', () => {
		const fetcher = vi.fn(() => Promise.resolve(new Response()));
		const waitUntil = vi.fn();
		kickPushDeliver(URL, TOKEN, fetcher as unknown as typeof fetch, waitUntil);
		expect(waitUntil).toHaveBeenCalledTimes(1);
		const arg = waitUntil.mock.calls[0][0];
		expect(arg).toBeInstanceOf(Promise);
	});

	it('swallows fetch rejections so the caller (the tap endpoint) never blows up', async () => {
		const err = new Error('network down');
		const fetcher = vi.fn(() => Promise.reject(err));
		let captured: Promise<unknown> | undefined;
		const waitUntil = vi.fn((p: Promise<unknown>) => {
			captured = p;
		});
		const consoleErr = vi.spyOn(console, 'error').mockImplementation(() => {});

		expect(kickPushDeliver(URL, TOKEN, fetcher as unknown as typeof fetch, waitUntil)).toBe(true);
		// Should resolve, not reject — we logged and moved on.
		await expect(captured).resolves.toBeUndefined();
		expect(consoleErr).toHaveBeenCalledWith('push-deliver kick failed', err);

		consoleErr.mockRestore();
	});
});
