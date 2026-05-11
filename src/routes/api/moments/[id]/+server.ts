import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	deleteMoment,
	MomentConflictError,
	MomentError,
	updateMoment,
	type UpdateMomentInput
} from '$lib/server/services/moments';
import { consume } from '$lib/server/rate-limit';

export const DELETE: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');
	const id = params.id;
	if (!id) error(400, 'missing_id');
	try {
		await deleteMoment(locals.user.id, locals.couple.id, id);
		return json({ ok: true });
	} catch (e) {
		if (e instanceof MomentError) {
			const status = e.code === 'not_found' ? 404 : e.code === 'not_author' ? 403 : 400;
			error(status, e.code);
		}
		throw e;
	}
};

export const PATCH: RequestHandler = async ({ params, locals, request }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');
	const id = params.id;
	if (!id) error(400, 'missing_id');

	const limit = consume('moments-write', locals.user.id);
	if (!limit.allowed) {
		return new Response(JSON.stringify({ error: 'rate_limited', retryAfter: limit.retryAfterMs }), {
			status: 429,
			headers: {
				'content-type': 'application/json',
				'retry-after': String(Math.ceil(limit.retryAfterMs / 1000))
			}
		});
	}

	let body: Record<string, unknown>;
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		error(400, 'invalid_json');
	}

	const ifMatch = body.ifMatch ?? body.ifMatchUpdatedAt;
	if (typeof ifMatch !== 'string') error(400, 'missing_if_match');

	const patch: UpdateMomentInput = { ifMatchUpdatedAt: ifMatch };
	if (typeof body.body === 'string') patch.body = body.body;
	if (typeof body.radiusM === 'number') patch.radiusM = body.radiusM;
	if (body.expiresAt === null || typeof body.expiresAt === 'string') {
		patch.expiresAt = body.expiresAt as string | null;
	}

	try {
		const fresh = await updateMoment(locals.user.id, locals.couple.id, id, patch);
		return json({ ok: true, moment: fresh });
	} catch (e) {
		if (e instanceof MomentConflictError) {
			return json({ error: 'conflict', current: e.current }, { status: 409 });
		}
		if (e instanceof MomentError) {
			const status =
				e.code === 'not_found'
					? 404
					: e.code === 'not_author'
						? 403
						: e.code === 'body_too_long'
							? 413
							: 400;
			error(status, e.code);
		}
		throw e;
	}
};
