import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { deleteMoment, MomentError } from '$lib/server/services/moments';

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
