// Per-request Supabase client for SvelteKit server hooks/load/+server.
// Uses @supabase/ssr so cookies (the actual session store) flow correctly
// between server-render and the browser. Always create a NEW client per
// request — never cache one across requests, or you'll leak sessions.
//
// Usage in hooks.server.ts:
//   const supabase = createSupabaseServerClient(event);
//   const { data: { user } } = await supabase.auth.getUser();
//
// `getUser()` (not `getSession()`) is the only safe way to authenticate
// a server request — getSession() reads the cookie without verifying the
// JWT signature, which is a security bug if you trust it for authz.

import { createServerClient } from '@supabase/ssr';
import { env } from '$env/dynamic/private';
import { env as pubEnv } from '$env/dynamic/public';
import type { RequestEvent } from '@sveltejs/kit';

export function createSupabaseServerClient(event: RequestEvent) {
	const url = pubEnv.PUBLIC_SUPABASE_URL;
	const anon = pubEnv.PUBLIC_SUPABASE_ANON_KEY;
	if (!url || !anon) {
		throw new Error(
			'PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY must be set. See .env.example.'
		);
	}

	return createServerClient(url, anon, {
		cookies: {
			getAll: () => event.cookies.getAll(),
			setAll: (cookies) => {
				for (const { name, value, options } of cookies) {
					event.cookies.set(name, value, { ...options, path: options?.path ?? '/' });
				}
			}
		}
	});
}

// Service-role client for server-only operations that must bypass RLS
// (admin tasks, cron jobs, seed scripts). NEVER use the result of this
// in response to a user request without first authenticating + authorizing.
export function createSupabaseAdminClient() {
	const url = pubEnv.PUBLIC_SUPABASE_URL;
	const key = env.SUPABASE_SERVICE_ROLE_KEY;
	if (!url || !key) {
		throw new Error('PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
	}
	// Lazy import to avoid bundling the admin client into the browser if
	// someone accidentally imports the wrong file.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const { createClient } = require('@supabase/supabase-js');
	return createClient(url, key, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
}
