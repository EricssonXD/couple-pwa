// F11 — POST /api/hourly/mood
//
// Set the caller's mood for the current hour. Mood is allowed without
// a clip — recording is optional, the mood meter is the always-on bit.
// Realtime broadcast emitted by the service.
//
// Request: { mood: 'joyful' | 'happy' | 'neutral' | 'sad' | 'upset' }

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import { HourlyError, isHourlyMood, setHourlyMoodNow } from '$lib/server/services/hourly';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const limit = consume('hourly-mood-write', locals.user.id);
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
	if (!isHourlyMood(body.mood)) error(400, 'invalid_mood');

	try {
		const snap = await setHourlyMoodNow({
			coupleId: locals.couple.id,
			userId: locals.user.id,
			mood: body.mood
		});
		return json(snap);
	} catch (e) {
		if (e instanceof HourlyError) error(400, e.code);
		throw e;
	}
};
