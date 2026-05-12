import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

// F7 — chat /+page.server.ts deliberately does NOT load any messages.
// Chat history is fetched client-side after hydration via /api/chat so:
//  1. The 7-day TTL cannot be defeated by an HTML / __data.json cache
//     (the SW also marks /chat as private — see src/service-worker.ts).
//  2. Cold launches show the shell instantly without blocking on a DB
//     round-trip.
// We only echo back identifiers needed to wire up the realtime client.

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	if (!locals.couple) redirect(303, '/onboarding/link');

	return {
		coupleId: locals.couple.id,
		viewerId: locals.user.id
	};
};
