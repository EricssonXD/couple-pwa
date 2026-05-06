import { fail, redirect } from '@sveltejs/kit';
import { eq } from 'drizzle-orm';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { profile } from '$lib/server/db/schema';

export const load: PageServerLoad = async ({ locals }) => {
	if (!locals.user) redirect(303, '/auth/sign-in');
	const [p] = await db.select().from(profile).where(eq(profile.userId, locals.user.id)).limit(1);
	if (p?.onboardedAt) redirect(303, locals.couple ? '/pulse' : '/onboarding/link');
	return { profile: p ?? null, name: locals.user.name };
};

export const actions: Actions = {
	default: async ({ locals, request }) => {
		if (!locals.user) redirect(303, '/auth/sign-in');
		const fd = await request.formData();
		const displayName = fd.get('displayName')?.toString().trim();
		const pronouns = fd.get('pronouns')?.toString().trim() || null;
		const avatarEmoji = fd.get('avatarEmoji')?.toString().trim() || null;
		const anniversary = fd.get('anniversary')?.toString().trim() || null;

		if (!displayName) return fail(400, { error: 'Display name required' });

		await db
			.insert(profile)
			.values({
				userId: locals.user.id,
				displayName,
				pronouns,
				avatarEmoji,
				onboardedAt: new Date()
			})
			.onConflictDoUpdate({
				target: profile.userId,
				set: { displayName, pronouns, avatarEmoji, onboardedAt: new Date() }
			});

		// Anniversary is currently a couple-level field; we'll wire it after pairing.
		// Stash on a cookie temporarily so the link step can pre-fill if desired.
		void anniversary;

		redirect(303, '/onboarding/link');
	}
};
