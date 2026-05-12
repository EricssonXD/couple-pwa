/**
 * F3 — POST /api/scheduled-notes
 *
 * Schedule a private note that becomes visible to the partner only
 * after `deliverAt`. Caller is the author (locals.user); couple is
 * derived from locals — never trust client-supplied IDs.
 *
 * Request body: { body: string; deliverAt: string (ISO 8601) }
 *
 * Errors map ScheduledNoteValidationError.code → HTTP:
 *   too_soon | too_far | body_empty | body_too_long → 400
 *   quota_exceeded → 429
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import { scheduleNote, ScheduledNoteValidationError } from '$lib/server/services/scheduledNotes';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const limit = consume('note-write', locals.user.id);
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
	if (typeof body.body !== 'string') error(400, 'invalid_body');
	if (typeof body.deliverAt !== 'string') error(400, 'invalid_deliver_at');

	const deliverAt = new Date(body.deliverAt);
	if (Number.isNaN(deliverAt.getTime())) error(400, 'invalid_deliver_at');

	try {
		const row = await scheduleNote({
			coupleId: locals.couple.id,
			authorId: locals.user.id,
			body: body.body,
			deliverAt
		});
		return json({ ok: true, id: row.id, deliverAt: row.deliverAt });
	} catch (e) {
		if (e instanceof ScheduledNoteValidationError) {
			const status = e.code === 'quota_exceeded' ? 429 : 400;
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};
