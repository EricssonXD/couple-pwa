// F11 — POST /api/hourly/caption
//
// Edit the caption on an existing hourly_clip owned by the caller.
// Pass `caption: null` (or empty string) to clear it.
//
// Request: { clipId: string, caption: string | null }

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import { HourlyError, setClipCaption } from '$lib/server/services/hourly';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const limit = consume('hourly-caption-write', locals.user.id);
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
	if (typeof body.clipId !== 'string' || body.clipId.length === 0) {
		error(400, 'invalid_clip_id');
	}
	const caption =
		body.caption === null || body.caption === undefined
			? null
			: typeof body.caption === 'string'
				? body.caption
				: undefined;
	if (caption === undefined) error(400, 'invalid_caption');

	try {
		const res = await setClipCaption({
			coupleId: locals.couple.id,
			userId: locals.user.id,
			clipId: body.clipId,
			caption
		});
		return json(res);
	} catch (e) {
		if (e instanceof HourlyError) {
			const status =
				e.code === 'clip_not_found' ? 404 : e.code === 'clip_owner_mismatch' ? 403 : 400;
			error(status, e.code);
		}
		throw e;
	}
};
