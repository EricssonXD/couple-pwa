import { redirect } from '@sveltejs/kit';
import { listForCouple } from '$lib/server/services/calendar';
import type { PageServerLoad } from './$types';

const HORIZON_DAYS = 365;

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	if (!locals.couple) redirect(303, '/onboarding/link');

	// v1 window: from start of today (UTC) to +365 days. v2 will
	// allow user-driven from/to and expand recurrence rules.
	const from = new Date();
	from.setUTCHours(0, 0, 0, 0);
	const to = new Date(from);
	to.setUTCDate(to.getUTCDate() + HORIZON_DAYS);

	const events = await listForCouple({ coupleId: locals.couple.id, from, to });

	return {
		events: events.map((e) => ({
			...e,
			startsAt: e.startsAt.toISOString(),
			endsAt: e.endsAt ? e.endsAt.toISOString() : null,
			createdAt: e.createdAt.toISOString(),
			updatedAt: e.updatedAt.toISOString()
		})),
		viewerId: locals.user.id
	};
};
