import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { createSupabaseServerClient } from '$lib/server/supabase';

export const load: PageServerLoad = async ({ locals, url }) => {
	if (locals.user) {
		const next = url.searchParams.get('next') ?? '/pulse';
		throw redirect(303, next);
	}
	return { mode: url.searchParams.get('mode') === 'signup' ? 'signup' : 'login' };
};

function describe(message: string): string {
	// Map a few of the common Supabase Auth error messages to something
	// friendlier, without leaking enumeration hints.
	if (/invalid login credentials/i.test(message)) return 'Wrong email or password.';
	if (/user already registered/i.test(message)) return 'An account with this email already exists.';
	return message;
}

export const actions: Actions = {
	login: async (event) => {
		const data = await event.request.formData();
		const email = String(data.get('email') ?? '').trim();
		const password = String(data.get('password') ?? '');

		if (!email || !password) {
			return fail(400, { mode: 'login', email, error: 'Email and password are required.' });
		}

		const supabase = createSupabaseServerClient(event);
		const { error } = await supabase.auth.signInWithPassword({ email, password });
		if (error) {
			return fail(400, { mode: 'login', email, error: describe(error.message) });
		}

		const next = event.url.searchParams.get('next') ?? '/pulse';
		throw redirect(303, next);
	},

	signup: async (event) => {
		const data = await event.request.formData();
		const email = String(data.get('email') ?? '').trim();
		const password = String(data.get('password') ?? '');

		if (!email || password.length < 8) {
			return fail(400, {
				mode: 'signup',
				email,
				error: 'Email and an 8+ character password are required.'
			});
		}

		const supabase = createSupabaseServerClient(event);
		const { data: signupData, error } = await supabase.auth.signUp({
			email,
			password,
			options: { emailRedirectTo: new URL('/auth/callback', event.url).toString() }
		});
		if (error) {
			return fail(400, { mode: 'signup', email, error: describe(error.message) });
		}

		// If email confirmation is enabled in Supabase Auth settings, session
		// will be null until the user clicks the link. Send them to a holding
		// page in that case; otherwise straight to onboarding.
		if (!signupData.session) {
			throw redirect(303, '/auth/check-email');
		}
		throw redirect(303, '/onboarding');
	}
};
