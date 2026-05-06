import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createMoment, listMomentsForViewer, MomentError } from '$lib/server/services/moments';

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');
	const moments = await listMomentsForViewer(locals.user.id, locals.couple.id);
	return json({ moments });
};

export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');

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
		return json({ ok: true, id });
	} catch (e) {
		if (e instanceof MomentError) error(400, e.code);
		throw e;
	}
};
