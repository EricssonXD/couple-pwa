import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// `/welcome` is the anonymous marketing/install surface. Signed-in users
// should never see it — bounce them to the app shell so the back button
// from /pulse can't surface a stale welcome flash.
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return {};
	if (locals.couple) redirect(303, '/pulse');
	redirect(303, '/onboarding');
};
