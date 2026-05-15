import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	if (!locals.couple) redirect(303, '/onboarding/link');

	// Today key in the user's local tz isn't known server-side; client
	// fetches /api/hourly/day?date=… with its own date once mounted.
	return {
		viewerId: locals.user.id,
		coupleId: locals.couple.id
	};
};
