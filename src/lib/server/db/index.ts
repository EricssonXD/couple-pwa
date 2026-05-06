import { AsyncLocalStorage } from 'node:async_hooks';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// On Cloudflare Workers, TCP sockets opened by `postgres-js` are bound to
// the I/O context of the request that created them — they become unusable
// in any subsequent request. A module-singleton client therefore works for
// the FIRST request that warms an isolate and intermittently 500s on every
// request after. The fix: build a fresh client per request, store it via
// AsyncLocalStorage (enabled by the `nodejs_als` compat flag), and end it
// when the response is sent (via `ctx.waitUntil` so the close happens
// out-of-band).

type Bundle = { client: Sql; db: PostgresJsDatabase<typeof schema> };

const als = new AsyncLocalStorage<Bundle>();

function makeBundle(): Bundle {
	const client = postgres(env.DATABASE_URL!, {
		prepare: false,
		max: 1,
		idle_timeout: 4,
		connect_timeout: 10
	});
	return { client, db: drizzle(client, { schema }) };
}

/**
 * Wraps an async unit of work so any `db.*` call inside resolves to a
 * fresh per-request Postgres client. Required on Cloudflare Workers.
 *
 * @param fn        the inner work (typically `() => resolve(event)`)
 * @param waitUntil optional CF execution-context `waitUntil` so the client
 *                  shutdown can finish out-of-band after the response
 */
export async function withDb<T>(
	fn: () => Promise<T>,
	waitUntil?: (p: Promise<unknown>) => void
): Promise<T> {
	const bundle = makeBundle();
	try {
		return await als.run(bundle, fn);
	} finally {
		const closing = bundle.client.end({ timeout: 1 }).catch(() => {});
		if (waitUntil) waitUntil(closing);
		else void closing;
	}
}

// Outside a request (seed scripts, RLS test, build-time checks) we still
// need a working `db`. Lazily create one ephemeral bundle per process and
// reuse — these contexts are not Workers and Node TCP sockets persist fine.
let fallback: Bundle | null = null;
function activeDb(): PostgresJsDatabase<typeof schema> {
	const ctx = als.getStore();
	if (ctx) return ctx.db;
	if (!fallback) fallback = makeBundle();
	return fallback.db;
}

// Proxy preserves `db.select(...).from(...).where(...)` ergonomics: every
// access dispatches to the request-scoped Drizzle instance.
export const db = new Proxy({} as PostgresJsDatabase<typeof schema>, {
	get(_target, prop, _receiver) {
		const target = activeDb() as unknown as Record<string | symbol, unknown>;
		const v = target[prop];
		return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
	}
});
