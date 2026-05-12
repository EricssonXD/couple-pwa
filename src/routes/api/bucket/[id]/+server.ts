/**
 * F6 — PATCH/DELETE /api/bucket/[id]
 *
 * PATCH: edit title/notes/targetDate, or toggle done state via
 *        body { done: boolean } (sets/clears done_at + done_by).
 *        Field-level edits and `done` are mutually exclusive in a
 *        single request to keep audit semantics clear.
 * DELETE: remove the item.
 *
 * coupleId is derived from locals — service-level WHERE enforces
 * couple membership even though RLS would also block it.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { consume } from '$lib/server/rate-limit';
import {
	updateItem,
	markDone,
	markUndone,
	deleteItem,
	BucketItemValidationError
} from '$lib/server/services/bucketList';

export const PATCH: RequestHandler = async ({ request, params, locals }) => {
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

	if (typeof body.done === 'boolean') {
		const ok = body.done
			? await markDone({ id: params.id!, coupleId: locals.couple.id, doneBy: locals.user.id })
			: await markUndone({ id: params.id!, coupleId: locals.couple.id });
		if (!ok) error(404, 'not_found');
		return json({ ok: true });
	}

	try {
		const ok = await updateItem({
			id: params.id!,
			coupleId: locals.couple.id,
			title: body.title,
			notes: body.notes,
			targetDate: body.targetDate
		});
		if (!ok) error(404, 'not_found');
		return json({ ok: true });
	} catch (e) {
		if (e instanceof BucketItemValidationError) {
			return new Response(JSON.stringify({ error: e.code, message: e.message }), {
				status: 400,
				headers: { 'content-type': 'application/json' }
			});
		}
		throw e;
	}
};

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const ok = await deleteItem({ id: params.id!, coupleId: locals.couple.id });
	if (!ok) error(404, 'not_found');
	return json({ ok: true });
};
