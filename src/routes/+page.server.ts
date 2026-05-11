import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// `/` is a router-only route — it never renders a body. Anonymous users
// go to `/welcome` (cacheable marketing page); authed users go straight
// to `/pulse` or `/onboarding`. Doing the branching at the route level
// (instead of conditionally rendering a hero) means the welcome HTML is
// NEVER cached at `/`, so a signed-in PWA cold-launch can't paint it
// even for a frame.
//
// The client-side fallback in +page.svelte handles the offline path
// where this server load never runs (SW serves the cached `/` HTML, which
// is essentially just a redirect script).
export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/welcome');
	if (locals.couple) redirect(303, '/pulse');
	redirect(303, '/onboarding');
};
