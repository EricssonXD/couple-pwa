import { redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { profile } from '$lib/server/db/schema';
import { getLiveLinkCode, issueLinkCode } from '$lib/server/services/couple';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	const [p] = await db.select().from(profile).where(eq(profile.userId, locals.user.id)).limit(1);
	if (!p?.onboardedAt) redirect(303, '/onboarding');
	if (locals.couple) redirect(303, '/pulse');

	// Auto-issue a code on first visit so the page renders ready-to-share.
	let code = await getLiveLinkCode(locals.user.id);
	if (!code) {
		const issued = await issueLinkCode(locals.user.id);
		code = {
			code: issued.code,
			issuerId: locals.user.id,
			expiresAt: issued.expiresAt,
			usedAt: null,
			consumedBy: null,
			createdAt: new Date()
		};
	}

	const origin = url.origin;
	return {
		code: code.code,
		expiresAt: code.expiresAt,
		shareUrl: `${origin}/onboarding/link?code=${code.code}`,
		prefillCode: url.searchParams.get('code') ?? ''
	};
};
