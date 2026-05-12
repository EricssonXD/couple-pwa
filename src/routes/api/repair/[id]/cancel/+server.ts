/**
 * F16 — POST /api/repair/[id]/cancel
 *
 * Either partner aborts an active session at any time.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import { cancelSession, RepairValidationError } from '$lib/server/services/repair';

export const POST: RequestHandler = async ({ params, locals }) => {
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

	try {
		const row = await cancelSession({
			coupleId: locals.couple.id,
			sessionId: params.id,
			userId: locals.user.id
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
