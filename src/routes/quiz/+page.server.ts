import { redirect } from '@sveltejs/kit';
import { listRunsForCouple, loadCatalog } from '$lib/server/services/quiz';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ fetch, locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	if (!locals.couple) redirect(303, '/onboarding/link');

	const [catalog, runs] = await Promise.all([
		loadCatalog(fetch),
		listRunsForCouple({ coupleId: locals.couple.id, viewerId: locals.user.id })
	]);

	return { catalog, runs };
};
