/**
 * Server-side realtime broadcast (Phase M6).
 *
 * Posts to Supabase Realtime's HTTP broadcast endpoint so we don't need a
 * persistent WebSocket from the server — `fetch` is portable, real WS clients
 * are not (Cloudflare Workers). Every browser sits on a Supabase Realtime
 * websocket already; this endpoint just fans the message out to all subscribers
 * of the topic.
 *
 * Topic convention: `couple:<coupleId>` (uuid).
 *
 * Privacy (M6): channels are PRIVATE. Subscribers must satisfy the RLS
 * policies in `drizzle/manual/0003_realtime_rls.sql` — i.e. they must be
 * authenticated as a partner of the couple. The service_role key used here
 * bypasses RLS, so the server can always broadcast; clients can only listen
 * (the policy denies client INSERTs on the broadcast extension to prevent
 * partner-spoofing of trusted events like `location_update` / `ghost_change`).
 * Client-originated events (heartbeat_tap) round-trip through server endpoints
 * (e.g. POST /api/realtime/tap) which re-broadcast here.
 */

import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import { dev } from '$app/environment';
import type { ServerEvent } from '$lib/realtime/protocol';

export function topicForCouple(coupleId: string): string {
	return `couple:${coupleId}`;
}

export async function broadcastToCouple(coupleId: string, event: ServerEvent): Promise<void> {
	const url = pubEnv.PUBLIC_SUPABASE_URL;
	const key = env.SUPABASE_SECRET_KEY;
	if (!url || !key) {
		throw new Error('PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY must be set for realtime.');
	}

	const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			apikey: key,
			authorization: `Bearer ${key}`
		},
		body: JSON.stringify({
			messages: [
				{
					topic: topicForCouple(coupleId),
					event: event.t,
					payload: event,
					private: true
				}
			]
		})
	});

	if (!res.ok && dev) {
		const text = await res.text().catch(() => '');
		// eslint-disable-next-line no-console
		console.warn('[realtime] broadcast failed', res.status, text);
	}
}
