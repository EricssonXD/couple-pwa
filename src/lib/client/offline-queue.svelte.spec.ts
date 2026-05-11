import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { enqueue, flush, queueSize, listDead, _resetForTest, MAX_ATTEMPTS } from './offline-queue';

// Runs in the `client` Vitest project (real Chromium → real IndexedDB).
// We stub `fetch` per-test to simulate online/offline/5xx/4xx responses.

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(impl as typeof fetch);
}

describe('offline-queue', () => {
	beforeEach(async () => {
		await _resetForTest();
	});
	afterEach(async () => {
		vi.restoreAllMocks();
		await _resetForTest();
	});

	it('enqueues a request and drains it on flush', async () => {
		const calls: Array<{ url: string; body: string | undefined; idem: string | null }> = [];
		mockFetch(async (input, init) => {
			const url = typeof input === 'string' ? input : (input as URL).toString();
			const headers = new Headers(init?.headers);
			calls.push({ url, body: init?.body as string, idem: headers.get('x-idempotency-key') });
			return new Response('', { status: 200 });
		});

		await enqueue('/api/location/ping', { lat: 1.23, lon: 4.56 }, { flushImmediately: false });
		expect(await queueSize()).toBe(1);

		const result = await flush();
		expect(result.delivered).toBe(1);
		expect(await queueSize()).toBe(0);
		expect(calls).toHaveLength(1);
		expect(calls[0].url).toBe('/api/location/ping');
		expect(calls[0].body).toContain('1.23');
		expect(calls[0].idem).toMatch(/.+/);
	});

	it('drops 4xx responses without retrying', async () => {
		mockFetch(async () => new Response('bad request', { status: 400 }));
		await enqueue('/api/moments', { body: 'x' }, { flushImmediately: false });
		const result = await flush();
		expect(result.dead).toBe(1);
		expect(result.retried).toBe(0);
		expect(await queueSize()).toBe(0); // dropped, not stored as dead
	});

	it('schedules a retry on 5xx and increments attempts', async () => {
		mockFetch(async () => new Response('boom', { status: 500 }));
		await enqueue('/api/location/ping', { lat: 1, lon: 2 }, { flushImmediately: false });
		const result = await flush();
		expect(result.retried).toBe(1);
		expect(result.delivered).toBe(0);
		expect(await queueSize()).toBe(1);
		// Second flush immediately after won't deliver — backoff pushed
		// nextAttemptAt into the future.
		const second = await flush();
		expect(second.delivered).toBe(0);
		expect(second.retried).toBe(0);
	});

	it('retries on a network failure (fetch throws)', async () => {
		mockFetch(async () => {
			throw new Error('network down');
		});
		await enqueue('/api/location/ping', { lat: 1, lon: 2 }, { flushImmediately: false });
		const r = await flush();
		expect(r.retried).toBe(1);
		expect(await queueSize()).toBe(1);
	});

	it('moves to dead-letter after MAX_ATTEMPTS', async () => {
		mockFetch(async () => new Response('boom', { status: 502 }));
		await enqueue('/api/location/ping', { lat: 1, lon: 2 }, { flushImmediately: false });
		// Force enough attempts by manipulating the entry directly through
		// the public surface: drain, then rewind nextAttemptAt by reaching
		// into IDB. Simpler: just call flush MAX_ATTEMPTS times after
		// rewinding. We rewind by reopening + lowering nextAttemptAt.
		for (let i = 0; i < MAX_ATTEMPTS; i++) {
			await rewindQueueEntries();
			await flush();
		}
		const dead = await listDead();
		expect(dead).toHaveLength(1);
		expect(dead[0].attempts).toBe(MAX_ATTEMPTS);
	});

	it('reuses the same idempotency key across retries of the same entry', async () => {
		const seen = new Set<string>();
		let pass = 0;
		mockFetch(async (_input, init) => {
			const headers = new Headers(init?.headers);
			seen.add(headers.get('x-idempotency-key') ?? '');
			pass++;
			return new Response('', { status: pass < 2 ? 503 : 200 });
		});
		await enqueue('/api/location/ping', { lat: 1, lon: 2 }, { flushImmediately: false });
		await flush(); // 503 → retried
		await rewindQueueEntries();
		await flush(); // 200 → delivered
		expect(seen.size).toBe(1);
		expect(await queueSize()).toBe(0);
	});

	it('preserves FIFO order across multiple enqueues', async () => {
		const order: string[] = [];
		mockFetch(async (_input, init) => {
			order.push(JSON.parse((init?.body as string) ?? '{}').tag);
			return new Response('', { status: 200 });
		});
		await enqueue('/api/x', { tag: 'a' }, { flushImmediately: false });
		await enqueue('/api/x', { tag: 'b' }, { flushImmediately: false });
		await enqueue('/api/x', { tag: 'c' }, { flushImmediately: false });
		await flush();
		expect(order).toEqual(['a', 'b', 'c']);
	});
});

// Helper: rewind every queued entry's nextAttemptAt to 0 so the next
// flush() sees them all as due. Needed because the production code
// honours backoff timestamps.
async function rewindQueueEntries(): Promise<void> {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const req = indexedDB.open('duosync-queue', 1);
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	await new Promise<void>((resolve, reject) => {
		const tx = db.transaction('pending', 'readwrite');
		const store = tx.objectStore('pending');
		const cursorReq = store.openCursor();
		cursorReq.onsuccess = () => {
			const c = cursorReq.result;
			if (!c) return;
			const v = c.value as { nextAttemptAt: number };
			v.nextAttemptAt = 0;
			c.update(v);
			c.continue();
		};
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
	});
	db.close();
}
