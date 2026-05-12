import { redirect } from '@sveltejs/kit';
import { listForCouple } from '$lib/server/services/bucketList';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	if (!locals.couple) redirect(303, '/onboarding/link');

	const items = await listForCouple(locals.couple.id);

	return {
		items,
		viewerId: locals.user.id
	};
};
