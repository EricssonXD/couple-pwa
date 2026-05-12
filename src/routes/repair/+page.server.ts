import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getActiveSession, listHistory } from '$lib/server/services/repair';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	if (!locals.couple) redirect(303, '/onboarding/link');

	const [active, history] = await Promise.all([
		getActiveSession(locals.couple.id),
		listHistory(locals.couple.id, 10)
	]);

	return {
		active,
		history,
		viewerId: locals.user.id
	};
};
