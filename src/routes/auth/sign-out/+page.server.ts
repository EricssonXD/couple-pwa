import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { createSupabaseServerClient } from '$lib/server/supabase';

// POST-only sign-out so a stale GET prefetch can't invalidate sessions.
export const actions: Actions = {
	default: async (event) => {
		const supabase = createSupabaseServerClient(event);
		await supabase.auth.signOut();
		throw redirect(303, '/auth/sign-in');
	}
};
