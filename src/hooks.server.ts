import { sequence } from '@sveltejs/kit/hooks';
import type { Handle, HandleServerError } from '@sveltejs/kit';
import { getTextDirection } from '$lib/paraglide/runtime';
import { paraglideMiddleware } from '$lib/paraglide/server';
import { createSupabaseServerClient } from '$lib/server/supabase';
import { getActiveCouple } from '$lib/server/services/couple';
import { readDeletionState } from '$lib/server/services/deletion';
import { withDb } from '$lib/server/db';
import { report } from '$lib/error-reporter';

// H2: security headers. CSP is configured in svelte.config.js (kit.csp).
// Everything else lands here so we can set it once for every response,
// including static assets routed through the Worker.
const handleSecurityHeaders: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	const h = response.headers;
	// Only meaningful over HTTPS — Cloudflare terminates TLS at the edge,
	// so the response will always be served over https in production. We
	// still set it unconditionally because browsers ignore HSTS over
	// plain http.
	if (!h.has('strict-transport-security')) {
		h.set('strict-transport-security', 'max-age=31536000; includeSubDomains; preload');
	}
	if (!h.has('referrer-policy')) {
		h.set('referrer-policy', 'strict-origin-when-cross-origin');
	}
	if (!h.has('x-content-type-options')) {
		h.set('x-content-type-options', 'nosniff');
	}
	if (!h.has('x-frame-options')) {
		h.set('x-frame-options', 'DENY');
	}
	if (!h.has('permissions-policy')) {
		// Allow geolocation + notifications for the app itself, deny the
		// camera/mic/etc. Browsers fall back to safe defaults if a
		// directive is unrecognised, so listing the deny-list explicitly
		// is fine.
		h.set(
			'permissions-policy',
			'geolocation=(self), notifications=(self), camera=(), microphone=(), payment=(), usb=(), magnetometer=(), gyroscope=()'
		);
	}
	if (!h.has('cross-origin-opener-policy')) {
		h.set('cross-origin-opener-policy', 'same-origin');
	}
	return response;
};

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

// Non-HttpOnly client-readable hint cookie. Holds NO secrets — purely a
// flag the client/SW-cached pages can read to know "this device has a
// signed-in session" without reaching the server. Used for two things:
//   1. Skipping the welcome flash on `/` when offline (cached HTML may
//      still be the unauth welcome variant). The value also encodes
//      whether to land on /pulse or /onboarding so a not-yet-linked
//      user doesn't get bounced into a dead /pulse cache.
//   2. Suppressing client navigations to `/auth/*` when offline — those
//      routes are intentionally not cached by the SW (private), so a
//      stranded user with a valid session would otherwise hit a dead end.
// Cleared the moment the server stops seeing a user.
const AUTH_HINT_COOKIE = 'ds_auth';

const handleSupabase: Handle = async ({ event, resolve }) => {
	const supabase = createSupabaseServerClient(event);

	// getUser() is the verified call (vs getSession() which trusts the cookie
	// without a JWT signature check). Slightly more expensive but the only
	// safe choice for SSR.
	const {
		data: { user }
	} = await supabase.auth.getUser();

	if (user) {
		// H4: gate signed-in requests against the soft-delete window. If the
		// 7-day deletion timer has elapsed, sign the user out immediately;
		// otherwise expose the timestamp so the UI can show a warning + the
		// cancel-deletion control.
		const deletion = await readDeletionState(user.id);
		if (deletion?.expired) {
			await supabase.auth.signOut();
			if (event.cookies.get(AUTH_HINT_COOKIE)) {
				event.cookies.delete(AUTH_HINT_COOKIE, { path: '/' });
			}
			return resolve(event, {
				filterSerializedResponseHeaders(name) {
					return name === 'content-range' || name === 'x-supabase-api-version';
				}
			});
		}
		event.locals.user = user;
		event.locals.pendingDeletionAt = deletion?.pendingUntil ?? null;
		const {
			data: { session }
		} = await supabase.auth.getSession();
		if (session) event.locals.session = session;

		const c = await getActiveCouple(user.id);
		if (c) event.locals.couple = c;

		// Encode the destination the server would have redirected to, so
		// the offline client at `/` can route to the right cached page
		// (was previously a flat '1' meaning only "any session").
		const desired = c ? 'pulse' : 'onboarding';
		if (event.cookies.get(AUTH_HINT_COOKIE) !== desired) {
			event.cookies.set(AUTH_HINT_COOKIE, desired, {
				path: '/',
				httpOnly: false,
				sameSite: 'lax',
				secure: event.url.protocol === 'https:',
				maxAge: 60 * 60 * 24 * 365
			});
		}
	} else if (event.cookies.get(AUTH_HINT_COOKIE)) {
		event.cookies.delete(AUTH_HINT_COOKIE, { path: '/' });
	}

	return resolve(event, {
		filterSerializedResponseHeaders(name) {
			// Required by @supabase/ssr so the Set-Cookie chain is forwarded.
			return name === 'content-range' || name === 'x-supabase-api-version';
		}
	});
};

export const handle: Handle = sequence(
	handleSecurityHeaders,
	handleDb,
	handleParaglide,
	handleSupabase
);

export const handleError: HandleServerError = ({ error, event, status, message }) => {
	// During prerender, accessing event.url.search throws — guard it.
	let url: string;
	try {
		url = event.url.pathname + event.url.search;
	} catch {
		url = event.url.pathname;
	}
	const { id, message: safe } = report(error, {
		side: 'server',
		url,
		route: event.route?.id ?? null,
		status,
		message
	});
	return { message: safe, errorId: id };
};
