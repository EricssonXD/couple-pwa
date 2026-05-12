/**
 * F16 — POST /api/repair/[id]/join
 *
 * Either partner posts to mark themselves "joined" and optionally
 * leave a partner_note. Initiator's call updates initiator_note instead.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import { joinSession, RepairValidationError } from '$lib/server/services/repair';

export const POST: RequestHandler = async ({ params, request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');
	if (!params.id) error(400, 'missing_id');

	const limit = consume('repair-write', locals.user.id);
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
		// optional body
	}

	try {
		const row = await joinSession({
			coupleId: locals.couple.id,
			sessionId: params.id,
			userId: locals.user.id,
			partnerNote: typeof body.partnerNote === 'string' ? body.partnerNote : undefined
		});
		return json({ ok: true, session: row });
	} catch (e) {
		if (e instanceof RepairValidationError) {
			const status = e.code === 'session_not_found' ? 404 : e.code === 'wrong_status' ? 409 : 400;
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};
