import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { profile } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	const [me] = await db.select().from(profile).where(eq(profile.userId, locals.user.id)).limit(1);
	if (!me?.onboardedAt) redirect(303, '/onboarding');
	if (!locals.couple) redirect(303, '/onboarding/link');
	return {};
};
