import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createMoment, listMomentsForViewer, MomentError } from '$lib/server/services/moments';
import { lookupIdempotent, readIdempotencyKey, storeIdempotent } from '$lib/server/idempotency';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');
	const moments = await listMomentsForViewer(locals.user.id, locals.couple.id);
	return json({ moments });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

	const idemKey = readIdempotencyKey(request.headers);
	if (idemKey) {
		const cached = lookupIdempotent(locals.user.id, idemKey);
		if (cached) {
			return new Response(cached.body, {
				status: cached.status,
				headers: { 'content-type': 'application/json', 'x-idempotent-replay': '1' }
			});
		}
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'invalid_json');
	}
	if (!body || typeof body !== 'object') error(400, 'invalid_body');
	const b = body as Record<string, unknown>;

	try {
		const id = await createMoment(locals.user.id, locals.couple.id, {
			lat: Number(b.lat),
			lon: Number(b.lon),
			radiusM: b.radiusM != null ? Number(b.radiusM) : 100,
			body: String(b.body ?? ''),
			expiresAt: b.expiresAt ? new Date(String(b.expiresAt)) : null
		});
		const payload = { ok: true as const, id };
		if (idemKey) storeIdempotent(locals.user.id, idemKey, 200, payload);
		return json(payload);
	} catch (e) {
		if (e instanceof MomentError) error(400, e.code);
		throw e;
	}
};
