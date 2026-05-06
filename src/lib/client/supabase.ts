// Browser Supabase client. Singleton — Supabase manages its own internal
// state (auth listener, realtime channels) and creating multiple clients
// causes duplicate listeners and surprising behavior.

import { createBrowserClient } from '@supabase/ssr';
import { env as pubEnv } from '$env/dynamic/public';
import type { SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
	if (_client) return _client;
	const url = pubEnv.PUBLIC_SUPABASE_URL;
	const key = pubEnv.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
	if (!url || !key) {
		throw new Error(
			'PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set in the environment.'
		);
	}
	_client = createBrowserClient(url, key);
	return _client;
}
