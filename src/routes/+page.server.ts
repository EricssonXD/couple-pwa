import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// Authed users should never see the marketing welcome page. Route them
// straight to the right destination so there's no flash. Anonymous users
// keep getting the welcome hero.
//
// We only branch on locals (already resolved by hooks.server.ts) — no DB
// hit on every cold landing. /onboarding and /onboarding/link will refine
// further if the user is partway through setup.
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) return {};
	if (locals.couple) redirect(303, '/pulse');
	redirect(303, '/onboarding');
};
