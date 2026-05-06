import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSupabaseServerClient } from '$lib/server/supabase';

// Email-confirmation / magic-link / OAuth landing.
// Supabase appends ?code=... that we exchange for a session.
export const GET: RequestHandler = async (event) => {
	const code = event.url.searchParams.get('code');
	const next = event.url.searchParams.get('next') ?? '/onboarding';

	if (code) {
		const supabase = createSupabaseServerClient(event);
		const { error } = await supabase.auth.exchangeCodeForSession(code);
		if (!error) throw redirect(303, next);
	}

	throw redirect(303, '/auth/sign-in?error=callback');
};
