/**
 * Offline write queue (R1).
 *
 * Persists POST/PATCH/DELETE bodies in IndexedDB so they survive page
 * refreshes, browser quits, and offline gaps. Drains automatically when
 * the network comes back, when the tab becomes visible, and (where
 * supported) via the Background Sync API after the SW receives a sync
 * event.
 *
 * Design choices:
 *  - Separate database (`duosync-queue`) so the kv cache in `idb.ts`
 *    can keep its own version line without coordination.
 *  - Auto-incrementing primary key gives us FIFO order for free.
 *  - Each entry tracks `attempts` and an `idempotencyKey` (random UUID
 *    generated on enqueue) — servers can use the key to deduplicate if
 *    the client retried after a 5xx that actually succeeded.
 *  - 4xx responses are NOT retried (they're contract violations, not
 *    transient failures); the entry is dropped + the failure is reported.
 *  - 5xx and network errors are retried with exponential backoff, up to
 *    `MAX_ATTEMPTS` (8 → ~17 minutes total). After that the entry is
 *    moved to a "dead-letter" state so the UI can surface "we couldn't
 *    deliver these" without infinite churn.
 *  - All exports are SSR-safe (no-op when `indexedDB` is undefined).
 */

const DB_NAME = 'duosync-queue';
const DB_VERSION = 1;
const STORE = 'pending';

export const MAX_ATTEMPTS = 8;
const BACKOFF_MS = [1_000, 2_000, 5_000, 15_000, 30_000, 60_000, 180_000, 600_000];

export interface QueuedRequest {
	id?: number; // assigned by IDB autoIncrement
	endpoint: string;
	method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
	body: unknown;
	idempotencyKey: string;
	createdAt: number;
	attempts: number;
	nextAttemptAt: number;
	dead?: boolean;
}

let dbPromise: Promise<IDBDatabase> | null = null;
let flushing = false;
let listeners = new Set<(size: number) => void>();

function openDb(): Promise<IDBDatabase> {
	if (typeof indexedDB === 'undefined') return Promise.reject(new Error('indexedDB unavailable'));
	if (dbPromise) return dbPromise;
	dbPromise = new Promise((resolve, reject) => {
		const req = indexedDB.open(DB_NAME, DB_VERSION);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(STORE)) {
				const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
				store.createIndex('nextAttemptAt', 'nextAttemptAt');
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
	return dbPromise;
}

async function tx<T>(
	mode: IDBTransactionMode,
	fn: (store: IDBObjectStore) => Promise<T>
): Promise<T> {
	const db = await openDb();
	const t = db.transaction(STORE, mode);
	const result = await fn(t.objectStore(STORE));
	await new Promise<void>((resolve, reject) => {
		t.oncomplete = () => resolve();
		t.onerror = () => reject(t.error);
		t.onabort = () => reject(t.error);
	});
	return result;
}

function reqAsPromise<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
	});
}

function uuid(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function notify(): Promise<void> {
	const size = await queueSize();
	for (const cb of listeners) {
		try {
			cb(size);
		} catch {
			/* ignore listener errors */
		}
	}
}

export async function queueSize(): Promise<number> {
	try {
		return await tx('readonly', (store) => reqAsPromise(store.count()));
	} catch {
		return 0;
	}
}

export function onQueueChange(cb: (size: number) => void): () => void {
	listeners.add(cb);
	return () => listeners.delete(cb);
}

export interface EnqueueOptions {
	method?: QueuedRequest['method'];
	idempotencyKey?: string;
	flushImmediately?: boolean;
}

export async function enqueue(
	endpoint: string,
	body: unknown,
	opts: EnqueueOptions = {}
): Promise<{ idempotencyKey: string }> {
	const entry: QueuedRequest = {
		endpoint,
		method: opts.method ?? 'POST',
		body,
		idempotencyKey: opts.idempotencyKey ?? uuid(),
		createdAt: Date.now(),
		attempts: 0,
		nextAttemptAt: Date.now()
	};
	try {
		await tx('readwrite', (store) => reqAsPromise(store.add(entry)));
	} catch {
		// IDB is broken — fall back to a single direct attempt so we don't
		// lose the write entirely on hostile environments (e.g. private mode).
		await deliver(entry).catch(() => undefined);
		return { idempotencyKey: entry.idempotencyKey };
	}
	void notify();
	if (opts.flushImmediately !== false) void flush();
	// Best-effort: ask the SW to schedule a background-sync flush so even
	// a closed tab will retry. iOS Safari ignores this — fine, we still
	// flush on the next visibility/online event.
	void registerBackgroundSync();
	return { idempotencyKey: entry.idempotencyKey };
}

async function deliver(entry: QueuedRequest): Promise<{ ok: boolean; status: number }> {
	const init: RequestInit = {
		method: entry.method,
		headers: {
			'content-type': 'application/json',
			'x-idempotency-key': entry.idempotencyKey
		},
		body: entry.body == null ? undefined : JSON.stringify(entry.body)
	};
	const res = await fetch(entry.endpoint, init);
	return { ok: res.ok, status: res.status };
}

export async function flush(): Promise<{ delivered: number; retried: number; dead: number }> {
	if (flushing) return { delivered: 0, retried: 0, dead: 0 };
	if (typeof indexedDB === 'undefined') return { delivered: 0, retried: 0, dead: 0 };
	flushing = true;
	const out = { delivered: 0, retried: 0, dead: 0 };
	try {
		const due = await readDue();
		for (const entry of due) {
			if (typeof navigator !== 'undefined' && navigator.onLine === false) break;
			let result: { ok: boolean; status: number };
			try {
				result = await deliver(entry);
			} catch {
				result = { ok: false, status: 0 };
			}
			if (result.ok) {
				await removeEntry(entry.id!);
				out.delivered++;
				continue;
			}
			if (result.status >= 400 && result.status < 500) {
				// Client error — won't get better with a retry. Drop + log.
				await removeEntry(entry.id!);
				out.dead++;
				console.warn('offline-queue: dropping 4xx', entry.endpoint, result.status);
				continue;
			}
			const attempts = entry.attempts + 1;
			if (attempts >= MAX_ATTEMPTS) {
				await markDead(entry.id!, attempts);
				out.dead++;
			} else {
				await scheduleRetry(entry.id!, attempts);
				out.retried++;
			}
		}
	} finally {
		flushing = false;
		void notify();
	}
	return out;
}

async function readDue(): Promise<QueuedRequest[]> {
	const now = Date.now();
	return tx('readonly', async (store) => {
		const idx = store.index('nextAttemptAt');
		const range = IDBKeyRange.upperBound(now);
		const cursorReq = idx.openCursor(range);
		const out: QueuedRequest[] = [];
		await new Promise<void>((resolve, reject) => {
			cursorReq.onsuccess = () => {
				const cursor = cursorReq.result;
				if (!cursor) return resolve();
				const v = cursor.value as QueuedRequest;
				if (!v.dead) out.push(v);
				cursor.continue();
			};
			cursorReq.onerror = () => reject(cursorReq.error);
		});
		out.sort((a, b) => a.createdAt - b.createdAt);
		return out;
	});
}

async function removeEntry(id: number): Promise<void> {
	await tx('readwrite', (store) => reqAsPromise(store.delete(id)));
}

async function scheduleRetry(id: number, attempts: number): Promise<void> {
	const delay = BACKOFF_MS[Math.min(attempts - 1, BACKOFF_MS.length - 1)];
	await tx('readwrite', async (store) => {
		const cur = (await reqAsPromise(store.get(id))) as QueuedRequest | undefined;
		if (!cur) return;
		cur.attempts = attempts;
		cur.nextAttemptAt = Date.now() + delay;
		await reqAsPromise(store.put(cur));
	});
}

async function markDead(id: number, attempts: number): Promise<void> {
	await tx('readwrite', async (store) => {
		const cur = (await reqAsPromise(store.get(id))) as QueuedRequest | undefined;
		if (!cur) return;
		cur.attempts = attempts;
		cur.dead = true;
		await reqAsPromise(store.put(cur));
	});
}

export async function listDead(): Promise<QueuedRequest[]> {
	try {
		return await tx('readonly', async (store) => {
			const all = (await reqAsPromise(store.getAll())) as QueuedRequest[];
			return all.filter((e) => e.dead);
		});
	} catch {
		return [];
	}
}

export async function clearDead(): Promise<void> {
	try {
		await tx('readwrite', async (store) => {
			const cursorReq = store.openCursor();
			await new Promise<void>((resolve, reject) => {
				cursorReq.onsuccess = () => {
					const cur = cursorReq.result;
					if (!cur) return resolve();
					if ((cur.value as QueuedRequest).dead) cur.delete();
					cur.continue();
				};
				cursorReq.onerror = () => reject(cursorReq.error);
			});
		});
	} catch {
		/* ignore */
	}
	void notify();
}

async function registerBackgroundSync(): Promise<void> {
	try {
		if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
		const reg = (await navigator.serviceWorker.ready) as ServiceWorkerRegistration & {
			sync?: { register: (tag: string) => Promise<void> };
		};
		await reg.sync?.register('duosync-queue-flush');
	} catch {
		/* unsupported (iOS Safari, Firefox) — fine, foreground triggers cover us */
	}
}

let installed = false;
export function installQueueRunner(): void {
	if (installed || typeof window === 'undefined') return;
	installed = true;
	const trigger = () => {
		if (navigator.onLine === false) return;
		void flush();
	};
	window.addEventListener('online', trigger);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') trigger();
	});
	void flush();
}

// Test-only: clears all queue state. Not exported to runtime callers.
export async function _resetForTest(): Promise<void> {
	dbPromise = null;
	listeners = new Set();
	flushing = false;
	if (typeof indexedDB === 'undefined') return;
	await new Promise<void>((resolve) => {
		const req = indexedDB.deleteDatabase(DB_NAME);
		req.onsuccess = () => resolve();
		req.onerror = () => resolve();
		req.onblocked = () => resolve();
	});
}
