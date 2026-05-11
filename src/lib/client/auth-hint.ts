// Reads the `ds_auth` hint cookie set by hooks.server.ts. Holds NO
// secret material — the actual session lives in the Supabase HttpOnly
// cookies. Used to make sensible navigation decisions while offline,
// where the server can't tell us anything.
//
// Value encodes the route the server would have redirected to:
//   'pulse'      — signed in + couple linked
//   'onboarding' — signed in + not linked (or profile incomplete)
//   null         — no session
// Legacy '1' from older cookies is treated as 'pulse' (best guess;
// will be overwritten on the next online request).

const COOKIE_NAME = 'ds_auth';

export type AuthHint = 'pulse' | 'onboarding';

export function readAuthHint(): AuthHint | null {
	if (typeof document === 'undefined') return null;
	const raw = document.cookie;
	if (!raw) return null;
	for (const part of raw.split(';')) {
		const [k, v] = part.trim().split('=');
		if (k === COOKIE_NAME) {
			if (v === 'pulse' || v === 'onboarding') return v;
			if (v === '1') return 'pulse'; // legacy
			return null;
		}
	}
	return null;
}

// Back-compat boolean wrapper for callers that only care "any session?".
export function hasAuthHint(): boolean {
	return readAuthHint() !== null;
}
