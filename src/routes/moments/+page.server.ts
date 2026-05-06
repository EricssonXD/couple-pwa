import { error } from '@sveltejs/kit';
import { listMomentsForViewer } from '$lib/server/services/moments';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');
	const moments = await listMomentsForViewer(locals.user.id, locals.couple.id);
	return {
		me: { id: locals.user.id },
		coupleId: locals.couple.id,
		moments
	};
};
