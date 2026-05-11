import { error, json } from '@sveltejs/kit';
import { sql } from 'drizzle-orm';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { pushSubscription } from '$lib/server/db/app.schema';
import { consume } from '$lib/server/rate-limit';

/**
 * Persist a Web Push subscription for the signed-in user. Idempotent on
 * `endpoint` — if the same browser re-subscribes (e.g. on rotation) we
 * update the credentials instead of inserting a duplicate row. RLS gates
 * read/delete; this endpoint is the only authorized writer.
 */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'unauthorized');

	const limit = consume('profile-write', locals.user.id);
	if (!limit.allowed) {
		return new Response(JSON.stringify({ error: 'rate_limited' }), {
			status: 429,
			headers: {
				'content-type': 'application/json',
				'retry-after': String(Math.ceil(limit.retryAfterMs / 1000))
			}
		});
	}

	let body: {
		endpoint?: unknown;
		keys?: { p256dh?: unknown; auth?: unknown };
		userAgent?: unknown;
	};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, 'invalid_json');
	}

	const endpoint = typeof body.endpoint === 'string' ? body.endpoint : null;
	const p256dh = typeof body.keys?.p256dh === 'string' ? body.keys.p256dh : null;
	const auth = typeof body.keys?.auth === 'string' ? body.keys.auth : null;
	const userAgent = typeof body.userAgent === 'string' ? body.userAgent.slice(0, 500) : null;

	if (!endpoint || !p256dh || !auth) error(400, 'invalid_subscription');
	if (!endpoint.startsWith('https://')) error(400, 'invalid_endpoint');

	await db
		.insert(pushSubscription)
		.values({ userId: locals.user.id, endpoint, p256dh, auth, userAgent })
		.onConflictDoUpdate({
			target: pushSubscription.endpoint,
			set: {
				userId: locals.user.id,
				p256dh,
				auth,
				userAgent,
				lastSeenAt: sql`now()`
			}
		});

	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ locals, request }) => {
	if (!locals.user) error(401, 'unauthorized');
	let body: { endpoint?: unknown };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		error(400, 'invalid_json');
	}
	const endpoint = typeof body.endpoint === 'string' ? body.endpoint : null;
	if (!endpoint) error(400, 'missing_endpoint');

	await db
		.delete(pushSubscription)
		.where(
			sql`${pushSubscription.endpoint} = ${endpoint} AND ${pushSubscription.userId} = ${locals.user.id}`
		);
	return json({ ok: true });
};
