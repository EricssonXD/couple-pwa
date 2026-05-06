import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { profile } from '$lib/server/db/schema';
import { loadDaily } from '$lib/server/services/daily';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	if (!locals.couple) redirect(303, '/onboarding/link');

	const view = await loadDaily(locals.user.id, locals.couple);

	const partnerId =
		locals.couple.partnerA === locals.user.id ? locals.couple.partnerB : locals.couple.partnerA;
	const profiles = await db
		.select({
			userId: profile.userId,
			displayName: profile.displayName,
			avatarEmoji: profile.avatarEmoji
		})
		.from(profile)
		.where(eq(profile.userId, partnerId));
	const partner = profiles[0] ?? null;

	return {
		daily: view,
		partner,
		viewerId: locals.user.id
	};
};
