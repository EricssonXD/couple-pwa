/**
 * F6 — POST /api/bucket
 *
 * Create a new bucket-list item for the authenticated user's couple.
 * Caller is the creator (locals.user); couple is derived from locals
 * — never trust client-supplied IDs.
 *
 * Request body: { title: string; notes?: string; targetDate?: 'YYYY-MM-DD' }
 *
 * Errors map BucketItemValidationError.code → HTTP:
 *   title_empty | title_too_long | notes_too_long | invalid_target_date → 400
 *   quota_exceeded → 429
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import { createItem, BucketItemValidationError } from '$lib/server/services/bucketList';

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const limit = consume('bucket-write', locals.user.id);
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

	try {
		const row = await createItem({
			coupleId: locals.couple.id,
			createdBy: locals.user.id,
			title: body.title,
			notes: body.notes,
			targetDate: body.targetDate
		});
		return json({ ok: true, id: row.id });
	} catch (e) {
		if (e instanceof BucketItemValidationError) {
			const status = e.code === 'quota_exceeded' ? 429 : 400;
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};
