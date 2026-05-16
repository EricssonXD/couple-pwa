// F11 — DELETE /api/hourly/clip?id=...
//
// Delete the caller's current-hour clip so they can re-shoot. Only the
// owner can call this and only while the hour bucket is still "now".
// Marks the row as delete_pending; the purge worker drains storage.
//
// Request: query `?id=<clipId>`

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import { HourlyError, deleteCurrentHourClip } from '$lib/server/services/hourly';

export const DELETE: RequestHandler = async ({ url, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const limit = consume('hourly-clip-delete', locals.user.id);
	if (!limit.allowed) {
		return new Response(JSON.stringify({ error: 'rate_limited' }), {
			status: 429,
			headers: {
				'content-type': 'application/json',
				'retry-after': String(Math.ceil(limit.retryAfterMs / 1000))
			}
		});
	}

	const clipId = url.searchParams.get('id');
	if (!clipId) error(400, 'invalid_clip_id');

	try {
		const res = await deleteCurrentHourClip({
			coupleId: locals.couple.id,
			userId: locals.user.id,
			clipId
		});
		return json(res);
	} catch (e) {
		if (e instanceof HourlyError) {
			const status =
				e.code === 'clip_not_found'
					? 404
					: e.code === 'clip_owner_mismatch'
						? 403
						: e.code === 'clip_not_current_hour'
							? 409
							: 400;
			error(status, e.code);
		}
		throw e;
	}
};
