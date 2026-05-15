// F11 — POST /api/hourly/upload-attempt
//
// Mints a server-derived signed upload URL for the current hour. The
// browser PUTs the recorded blob directly to Supabase Storage; the
// Worker never touches the bytes (Cloudflare body/CPU limits).
//
// Request: { mime: 'video/webm' | 'video/mp4' }
// Response: { attemptId, uploadUrl, storageKey, expiresAt, hourBucket }
//
// hourBucket / storageKey / userId / coupleId all server-derived —
// NOTHING is taken from the client beyond the requested mime.

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import { HourlyError, isHourlyMime, issueUploadAttempt } from '$lib/server/services/hourly';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const limit = consume('hourly-upload-attempt', locals.user.id);
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
	if (!isHourlyMime(body.mime)) error(400, 'invalid_mime');

	try {
		const attempt = await issueUploadAttempt({
			coupleId: locals.couple.id,
			userId: locals.user.id,
			mime: body.mime
		});
		return json(attempt);
	} catch (e) {
		if (e instanceof HourlyError) error(400, e.code);
		throw e;
	}
};
