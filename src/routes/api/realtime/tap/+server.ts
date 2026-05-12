/**
 * Heartbeat-tap endpoint (Phase M6).
 *
 * Replaces the previous client-side `channel.send({ event: 'heartbeat_tap' })`.
 * Under M6's private-channel model, clients no longer have INSERT permission
 * on the trusted server-events broadcast topic — that prevents one partner
 * from forging `location_update` / `ghost_change` events. Heartbeat taps now
 * round-trip through the server, which validates the caller and re-emits the
 * tap via the service-role REST broadcast (which bypasses RLS).
 *
 * Auth: requires `locals.user` (SSR Supabase session) AND `locals.couple`.
 * No body needed — the userId is taken from the authenticated session.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { broadcastToCouple } from '$lib/server/realtime';
import { notifyHeartbeatTap } from '$lib/server/services/notifications';
import { db } from '$lib/server/db';
import { profile } from '$lib/server/db/app.schema';
import { eq } from 'drizzle-orm';

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const userId = locals.user.id;
	const partnerId =
		locals.couple.partnerA === userId ? locals.couple.partnerB : locals.couple.partnerA;

	await broadcastToCouple(locals.couple.id, {
		t: 'heartbeat_tap',
		ts: Date.now(),
		p: { userId }
	});

	// Push notification to partner. Failure shouldn't 500 the tap — the
	// realtime broadcast already succeeded, push is best-effort.
	try {
		const [author] = await db
			.select({ displayName: profile.displayName })
			.from(profile)
			.where(eq(profile.userId, userId))
			.limit(1);
		await notifyHeartbeatTap({
			coupleId: locals.couple.id,
			recipientId: partnerId,
			authorDisplayName: author?.displayName ?? null
		});
	} catch (e) {
		console.error('notifyHeartbeatTap failed', e);
	}

	return json({ ok: true });
};
