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

export const POST: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	await broadcastToCouple(locals.couple.id, {
		t: 'heartbeat_tap',
		ts: Date.now(),
		p: { userId: locals.user.id }
	});

	return json({ ok: true });
};
