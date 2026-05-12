import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	if (!locals.couple) redirect(303, '/onboarding/link');

	return {
		coupleSince: locals.couple.createdAt,
		anniversary: locals.couple.anniversary ?? null,
		coupleNickname: locals.couple.nickname ?? null
	};
};
