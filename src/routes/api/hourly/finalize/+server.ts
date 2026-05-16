// F11 — POST /api/hourly/finalize
//
// Browser calls this once it has finished PUT-ing the recorded blob
// to the signed upload URL. Server re-validates the time window,
// queries Supabase Storage for the object's size + mime, then promotes
// the attempt to a `ready` hourly_clip row. Any prior ready row for
// the same hour is marked delete_pending (purge worker drains it).
//
// Request: { attemptId: string }

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { HourlyError, finalizeClipAttempt } from '$lib/server/services/hourly';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		error(400, 'invalid_json');
	}
	if (typeof body.attemptId !== 'string' || body.attemptId.length === 0) {
		error(400, 'invalid_attempt_id');
	}

	try {
		const finalized = await finalizeClipAttempt({
			coupleId: locals.couple.id,
			userId: locals.user.id,
			attemptId: body.attemptId,
			caption: typeof body.caption === 'string' ? body.caption : null
		});
		return json(finalized);
	} catch (e) {
		if (e instanceof HourlyError) {
			const status =
				e.code === 'attempt_not_found' || e.code === 'attempt_owner_mismatch'
					? 404
					: e.code === 'attempt_expired' || e.code === 'attempt_already_finalized'
						? 409
						: 400;
			error(status, e.code);
		}
		throw e;
	}
};
