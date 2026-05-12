/**
 * F5 mood pulse — POST /api/mood
 *
 * Append the caller's current mood (5-bucket emoji), then broadcast a
 * `mood_change` event so the partner's /pulse page updates the mood badge
 * in real time.
 *
 * Server-authoritative broadcast (M6 model): clients can't INSERT on the
 * trusted broadcast topic, so the round-trip lives here.
 *
 * Request body: { mood: 'joyful' | 'happy' | 'neutral' | 'sad' | 'upset' }
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import { broadcastToCouple } from '$lib/server/realtime';
import { isMood, setMood } from '$lib/server/services/mood';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const limit = consume('mood-write', locals.user.id);
	if (!limit.allowed) {
		return new Response(JSON.stringify({ error: 'rate_limited' }), {
			status: 429,
			headers: {
				'content-type': 'application/json',
				'retry-after': String(Math.ceil(limit.retryAfterMs / 1000))
			}
		});
	}

	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		error(400, 'invalid_json');
	}
	if (!isMood(body.mood)) error(400, 'invalid_mood');

	const snap = await setMood({
		userId: locals.user.id,
		coupleId: locals.couple.id,
		mood: body.mood
	});

	await broadcastToCouple(locals.couple.id, {
		t: 'mood_change',
		ts: Date.now(),
		p: { userId: locals.user.id, mood: snap.mood, setAt: snap.setAt }
	});

	return json({ ok: true, mood: snap.mood, setAt: snap.setAt });
};
