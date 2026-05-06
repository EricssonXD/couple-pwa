import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { profile, user } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	const [me] = await db.select().from(profile).where(eq(profile.userId, locals.user.id)).limit(1);
	if (!me?.onboardedAt) redirect(303, '/onboarding');
	if (!locals.couple) redirect(303, '/onboarding/link');

	const partnerId =
		locals.couple.partnerA === locals.user.id ? locals.couple.partnerB : locals.couple.partnerA;
	const [partnerProfile] = await db
		.select({
			displayName: profile.displayName,
			avatarEmoji: profile.avatarEmoji,
			name: user.name
		})
		.from(user)
		.leftJoin(profile, eq(profile.userId, user.id))
		.where(eq(user.id, partnerId))
		.limit(1);

	return {
		me: { displayName: me.displayName, avatarEmoji: me.avatarEmoji },
		partner: partnerProfile ?? null,
		coupleSince: locals.couple.createdAt
	};
};
