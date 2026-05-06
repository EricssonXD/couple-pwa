/**
 * Server-side realtime broadcast (Phase M4).
 *
 * Posts to Supabase Realtime's HTTP broadcast endpoint so that we don't
 * need a persistent WebSocket from the server. This is the only thing
 * Cloudflare Workers can do — `fetch` is portable, real WS clients are
 * not. Every browser sits on a Supabase Realtime websocket already; this
 * endpoint just fans the message out to all subscribers of the topic.
 *
 * Topic convention: `couple:<coupleId>` (uuid).
 *
 * Privacy note (MVP): channels are public (private: false). The topic
 * uuid (122 bits) is treated as the access secret. This is a known
 * short-lived exception — to be upgraded to private channels with RLS
 * policies on `realtime.messages` in a follow-up. See plan.md §M6.
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
					private: false
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
