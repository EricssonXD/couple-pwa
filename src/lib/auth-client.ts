// Re-exports + thin browser-side helpers for Supabase Auth.
//
// Most pages drive auth via SvelteKit form actions (server-side), which is
// the canonical Supabase + SvelteKit pattern: cookies are set on the SSR
// response so the very next navigation is already authenticated. This
// module exists for the few cases that need a client-side handle (e.g.
// listening to onAuthStateChange to react to passive token refresh).

import { getSupabaseClient } from '$lib/client/supabase';

export { getSupabaseClient };
