import { error } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import { listMomentsForViewer } from '$lib/server/services/moments';
import { db } from '$lib/server/db';
import { profile } from '$lib/server/db/schema';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) error(401, 'unauthorized');
	if (!locals.couple) error(409, 'not_paired');
	const moments = await listMomentsForViewer(locals.user.id, locals.couple.id);
	const partnerId =
		locals.couple.partnerA === locals.user.id ? locals.couple.partnerB : locals.couple.partnerA;
	const [partnerProfile] = await db
		.select({ displayName: profile.displayName })
		.from(profile)
		.where(eq(profile.userId, partnerId))
		.limit(1);
	return {
		me: { id: locals.user.id },
		coupleId: locals.couple.id,
		moments,
		partnerName: partnerProfile?.displayName ?? '夥伴'
	};
};
