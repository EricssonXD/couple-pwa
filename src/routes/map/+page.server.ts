import { redirect } from '@sveltejs/kit';
import { desc, eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { locationPing, profile } from '$lib/server/db/schema';
import { isGhostActive } from '$lib/server/services/location';
import type { PageServerLoad } from './$types';

async function lastPing(userId: string) {
	const [row] = await db
		.select({ lat: locationPing.lat, lon: locationPing.lon, capturedAt: locationPing.capturedAt })
		.from(locationPing)
		.where(eq(locationPing.userId, userId))
		.orderBy(desc(locationPing.capturedAt))
		.limit(1);
	return row ?? null;
}

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	if (!locals.couple) redirect(303, '/onboarding/link');

	const partnerId =
		locals.couple.partnerA === locals.user.id ? locals.couple.partnerB : locals.couple.partnerA;

	const [meProfile, partnerProfile, mine, theirs] = await Promise.all([
		db
			.select({ displayName: profile.displayName, avatarEmoji: profile.avatarEmoji })
			.from(profile)
			.where(eq(profile.userId, locals.user.id))
			.limit(1)
			.then((r) => r[0] ?? null),
		db
			.select({
				displayName: profile.displayName,
				avatarEmoji: profile.avatarEmoji,
				ghostMode: profile.ghostMode,
				ghostUntil: profile.ghostUntil
			})
			.from(profile)
			.where(eq(profile.userId, partnerId))
			.limit(1)
			.then((r) => r[0] ?? null),
		lastPing(locals.user.id),
		lastPing(partnerId)
	]);

	const partnerGhost = isGhostActive(
		partnerProfile?.ghostMode ?? false,
		partnerProfile?.ghostUntil
	);

	return {
		me: {
			id: locals.user.id,
			displayName: meProfile?.displayName ?? '你',
			avatarEmoji: meProfile?.avatarEmoji ?? '🌱',
			lat: mine?.lat ?? null,
			lon: mine?.lon ?? null
		},
		partner: {
			id: partnerId,
			displayName: partnerProfile?.displayName ?? '夥伴',
			avatarEmoji: partnerProfile?.avatarEmoji ?? '💞',
			lat: partnerGhost ? null : (theirs?.lat ?? null),
			lon: partnerGhost ? null : (theirs?.lon ?? null),
			ghost: partnerGhost
		},
		coupleId: locals.couple.id
	};
};

