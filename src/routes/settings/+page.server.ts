import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { profile } from '$lib/server/db/schema';
import { isGhostActive } from '$lib/server/services/location';
import { getStreak } from '$lib/server/services/connection';
import { getMoodTrend } from '$lib/server/services/mood';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	const [me] = await db.select().from(profile).where(eq(profile.userId, locals.user.id)).limit(1);
	if (!me) redirect(303, '/onboarding');

	let partner = null;
	if (locals.couple) {
		const partnerId =
			locals.couple.partnerA === locals.user.id ? locals.couple.partnerB : locals.couple.partnerA;
		const [p] = await db
			.select({ displayName: profile.displayName, avatarEmoji: profile.avatarEmoji })
			.from(profile)
			.where(eq(profile.userId, partnerId))
			.limit(1);
		partner = p ? { id: partnerId, ...p } : null;
	}

	const streak = locals.couple ? await getStreak(locals.couple.id) : null;
	const moodTrend = await getMoodTrend(locals.user.id, 14);

	return {
		me: {
			id: locals.user.id,
			email: locals.user.email ?? null,
			displayName: me.displayName,
			avatarEmoji: me.avatarEmoji,
			ghostMode: isGhostActive(me.ghostMode, me.ghostUntil),
			pendingDeletionAt: locals.pendingDeletionAt ?? null
		},
		couple: locals.couple
			? {
					id: locals.couple.id,
					nickname: locals.couple.nickname,
					anniversary: locals.couple.anniversary,
					createdAt: locals.couple.createdAt
				}
			: null,
		partner,
		streak,
		moodTrend
	};
};
