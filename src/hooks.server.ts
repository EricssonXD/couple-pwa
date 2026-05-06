import { sequence } from '@sveltejs/kit/hooks';
import type { Handle } from '@sveltejs/kit';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { getActiveCouple } from '$lib/server/services/couple';

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

export const handle: Handle = sequence(handleParaglide, handleSupabase);
