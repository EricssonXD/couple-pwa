import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { profile } from '$lib/server/db/schema';
import { bucketFor, getPulseState, isGhostActive } from '$lib/server/services/location';
import { resurfaceMemory } from '$lib/server/services/memory';

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
			avatarEmoji: profile.avatarEmoji
		})
		.from(profile)
		.where(eq(profile.userId, partnerId))
		.limit(1);

	const state = await getPulseState(locals.user.id, locals.couple.id);
	const memory = await resurfaceMemory(locals.couple.id);

	return {
		me: {
			id: locals.user.id,
			displayName: me.displayName,
			avatarEmoji: me.avatarEmoji,
			ghostMode: isGhostActive(me.ghostMode, me.ghostUntil),
			ghostUntil: me.ghostUntil
		},
		partner: partnerProfile ? { ...partnerProfile, id: partnerId } : null,
		coupleId: locals.couple.id,
		coupleSince: locals.couple.createdAt,
		coupleNickname: locals.couple.nickname ?? null,
		anniversary: locals.couple.anniversary ?? null,
		initialState: {
			me: state.mine && {
				capturedAt: state.mine.capturedAt,
				batteryPct: state.mine.batteryPct,
				charging: state.mine.charging
			},
			partner: state.partner,
			distanceM: state.distanceM,
			bucket: bucketFor(state.distanceM)
		},
		memory
	};
};
