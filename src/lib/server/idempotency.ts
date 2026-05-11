/**
 * Per-user idempotency cache for write endpoints.
 *
 * Clients (the offline queue, primarily) attach an `x-idempotency-key`
 * header to retried POSTs. If the same user replays the same key
 * within the TTL, we short-circuit and return the cached response so
 * a 5xx-then-success retry doesn't create duplicate rows server-side.
 *
 * Storage: an in-memory LRU per Worker isolate. This is "best-effort"
 * — Cloudflare may run multiple isolates and a request can hit either,
 * but in practice consecutive retries from the same client land on
 * the same isolate within seconds. For stronger guarantees we would
 * need KV or D1; the current design is acceptable because the worst
 * case (a duplicate that slips past the cache) is bounded by
 * downstream constraints (location pings dedupe via timestamp +
 * MIN_PING_MOVEMENT_M; moments dedupe via the body+lat+lon+couple
 * tuple in `createMoment`).
 *
 * SSR-safe: the cache lives on a module singleton; no Node globals.
 */

interface Entry {
	expiresAt: number;
	status: number;
	body: string; // serialized JSON
}

const TTL_MS = 5 * 60 * 1000; // 5 minutes — covers the queue's 8-attempt backoff (~17 min worst case)
const MAX_ENTRIES = 500;

const cache = new Map<string, Entry>();

function compositeKey(userId: string, idempotencyKey: string): string {
	return `${userId}:${idempotencyKey}`;
}

function evictExpired(now: number): void {
	if (cache.size < MAX_ENTRIES) return;
	for (const [k, v] of cache) {
		if (v.expiresAt <= now) cache.delete(k);
	}
	// If still over, drop oldest insertion-order entries.
	while (cache.size > MAX_ENTRIES) {
		const first = cache.keys().next().value;
		if (first === undefined) break;
		cache.delete(first);
	}
}

export interface CachedResponse {
	status: number;
	body: string;
}

export function lookupIdempotent(userId: string, key: string): CachedResponse | null {
	const composite = compositeKey(userId, key);
	const entry = cache.get(composite);
	if (!entry) return null;
	if (entry.expiresAt <= Date.now()) {
		cache.delete(composite);
		return null;
	}
	// Re-insert to bump LRU position.
	cache.delete(composite);
	cache.set(composite, entry);
	return { status: entry.status, body: entry.body };
}

export function storeIdempotent(userId: string, key: string, status: number, body: unknown): void {
	const composite = compositeKey(userId, key);
	const now = Date.now();
	evictExpired(now);
	cache.set(composite, {
		expiresAt: now + TTL_MS,
		status,
		body: typeof body === 'string' ? body : JSON.stringify(body)
	});
}

/**
 * Read + validate the `x-idempotency-key` header. Returns null when
 * absent or malformed (clients without the offline queue won't send
 * one — that's fine, they just don't get dedupe).
 */
export function readIdempotencyKey(headers: Headers): string | null {
	const raw = headers.get('x-idempotency-key');
	if (!raw) return null;
	const trimmed = raw.trim();
	// Bound the key length to defeat memory abuse.
	if (trimmed.length === 0 || trimmed.length > 128) return null;
	return trimmed;
}

// Test-only.
export function _resetForTest(): void {
	cache.clear();
}
