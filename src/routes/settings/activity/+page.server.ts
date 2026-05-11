import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { listAudit } from '$lib/server/services/audit';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	const entries = await listAudit(locals.user.id, 100);
	return {
		entries: entries.map((e) => ({
			id: e.id,
			action: e.action,
			metadata: e.metadata,
			createdAt: e.createdAt.toISOString()
		}))
	};
};
