// H3 — per-user token-bucket rate limit for write endpoints.
//
// Same "best-effort" caveat as src/lib/server/idempotency.ts: the cache
// is in-memory per Worker isolate, so an attacker can buy a small amount
// of extra throughput by hitting different isolates. That's fine — this
// limiter exists to protect against:
//   - runaway clients (offline queue draining all at once)
//   - accidental abuse from a misbehaving page
//   - cheap flooding from a single signed-in user
// True DDoS protection lives at the Cloudflare WAF layer (configured in
// the dashboard, not in code). Document that in commits/runbooks.

export type RateLimitBucket = 'moments-write' | 'profile-write';

export interface RateLimitConfig {
	/** Max tokens in the bucket (== max burst). */
	capacity: number;
	/** Tokens added per second (== sustained rate). */
	refillPerSec: number;
}

const CONFIGS: Record<RateLimitBucket, RateLimitConfig> = {
	'moments-write': { capacity: 30, refillPerSec: 30 / 60 }, // 30/min sustained, burst 30
	'profile-write': { capacity: 20, refillPerSec: 20 / 60 } // 20/min sustained, burst 20
};

interface BucketState {
	tokens: number;
	updatedAt: number; // ms
}

const STATE = new Map<string, BucketState>();
const MAX_ENTRIES = 5_000;

function key(bucket: RateLimitBucket, userId: string): string {
	return `${bucket}:${userId}`;
}

export interface RateLimitResult {
	allowed: boolean;
	/** Tokens left in the bucket after this call (>= 0). */
	remaining: number;
	/** ms until at least one token will be available (0 when allowed). */
	retryAfterMs: number;
}

export function consume(
	bucket: RateLimitBucket,
	userId: string,
	now: number = Date.now()
): RateLimitResult {
	const cfg = CONFIGS[bucket];
	const k = key(bucket, userId);
	const prev = STATE.get(k);
	let tokens: number;
	if (!prev) {
		// Fresh bucket starts full so the first request is never throttled.
		tokens = cfg.capacity;
	} else {
		const elapsedMs = Math.max(0, now - prev.updatedAt);
		tokens = Math.min(cfg.capacity, prev.tokens + (elapsedMs / 1000) * cfg.refillPerSec);
	}

	if (tokens < 1) {
		const deficit = 1 - tokens;
		const retryAfterMs = Math.ceil((deficit / cfg.refillPerSec) * 1000);
		// Track the most-recent updatedAt so refill keeps accumulating.
		STATE.set(k, { tokens, updatedAt: now });
		evictIfFull();
		return { allowed: false, remaining: 0, retryAfterMs };
	}

	tokens -= 1;
	STATE.set(k, { tokens, updatedAt: now });
	evictIfFull();
	return { allowed: true, remaining: Math.floor(tokens), retryAfterMs: 0 };
}

function evictIfFull(): void {
	if (STATE.size <= MAX_ENTRIES) return;
	// Drop the oldest 10% (Map iteration is insertion-order). Cheap and
	// good enough — the limit only protects memory, not correctness.
	const drop = Math.ceil(MAX_ENTRIES * 0.1);
	let i = 0;
	for (const k of STATE.keys()) {
		if (i++ >= drop) break;
		STATE.delete(k);
	}
}

/** Test-only helper. */
export function _resetForTest(): void {
	STATE.clear();
}
