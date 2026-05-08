import { redirect } from '@sveltejs/kit';
import type { Actions } from './$types';
import { createSupabaseServerClient } from '$lib/server/supabase';

// POST-only sign-out so a stale GET prefetch can't invalidate sessions.
export const actions: Actions = {
	default: async (event) => {
		const supabase = createSupabaseServerClient(event);
		await supabase.auth.signOut();
		// Explicitly clear the non-HttpOnly auth hint cookie alongside the
		// HttpOnly Supabase cookies. The hooks.server.ts handler also clears
		// it on the next request that sees no user, but doing it here closes
		// the race where the cached `/` HTML's pre-paint script could still
		// see `ds_auth=1` and re-route a just-signed-out user into a cached
		// authed app shell.
		event.cookies.delete('ds_auth', { path: '/' });
		throw redirect(303, '/auth/sign-in');
	}
};
