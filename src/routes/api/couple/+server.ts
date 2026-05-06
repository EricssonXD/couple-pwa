import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { updateCoupleMeta, unpair, ProfileError } from '$lib/server/services/couple';

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');
	let body: Record<string, unknown> = {};
	try {
		body = (await request.json()) as Record<string, unknown>;
	} catch {
		error(400, 'invalid_json');
	}
	try {
		await updateCoupleMeta(locals.user.id, locals.couple.id, {
			nickname:
				body.nickname === undefined
					? undefined
					: body.nickname === null
						? null
						: String(body.nickname),
			anniversary:
				body.anniversary === undefined
					? undefined
					: body.anniversary === null
						? null
						: String(body.anniversary)
		});
		return json({ ok: true });
	} catch (e) {
		if (e instanceof ProfileError) error(400, e.code);
		throw e;
	}
};

export const DELETE: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');
	await unpair(locals.user.id, locals.couple.id);
	return json({ ok: true });
};
