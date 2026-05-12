import { redirect } from '@sveltejs/kit';
import { listPendingForAuthor, listDeliveredForCouple } from '$lib/server/services/scheduledNotes';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	if (!locals.couple) redirect(303, '/onboarding/link');

	const [pending, delivered] = await Promise.all([
		listPendingForAuthor(locals.user.id),
		listDeliveredForCouple(locals.couple.id)
	]);

	return {
		pending,
		delivered,
		viewerId: locals.user.id
	};
};
