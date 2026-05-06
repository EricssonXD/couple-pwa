import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { getActiveCouple } from '$lib/server/services/couple';
import { withDb } from '$lib/server/db';

// Wrap every request in a fresh Postgres client (see src/lib/server/db
// for the rationale — Cloudflare Workers TCP sockets can't survive past
// the request that opened them).
const handleDb: Handle = ({ event, resolve }) => {
	// adapter-cloudflare exposes the execution context via event.platform.context.
	// Falls back to undefined locally (vite dev) — no waitUntil needed there.
	const platform = event.platform as
		| { context?: { waitUntil?: (p: Promise<unknown>) => void } }
		| undefined;
	const waitUntil = platform?.context?.waitUntil?.bind(platform.context);
	return withDb(() => Promise.resolve(resolve(event)), waitUntil);
};

const handleParaglide: Handle = ({ event, resolve }) =>
	paraglideMiddleware(event.request, ({ request, locale }) => {
		event.request = request;

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%paraglide.lang%', locale)
					.replace('%paraglide.dir%', getTextDirection(locale))
		});
	});

const handleSupabase: Handle = async ({ event, resolve }) => {
	const supabase = createSupabaseServerClient(event);

	// getUser() is the verified call (vs getSession() which trusts the cookie
	// without a JWT signature check). Slightly more expensive but the only
	// safe choice for SSR.
	const {
		data: { user }
	} = await supabase.auth.getUser();

	if (user) {
		event.locals.user = user;
		const {
			data: { session }
		} = await supabase.auth.getSession();
		if (session) event.locals.session = session;

		const c = await getActiveCouple(user.id);
		if (c) event.locals.couple = c;
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			// Required by @supabase/ssr so the Set-Cookie chain is forwarded.
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};

export const handle: Handle = sequence(handleDb, handleParaglide, handleSupabase);
