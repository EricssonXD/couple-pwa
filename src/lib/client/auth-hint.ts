// Reads the `ds_auth` hint cookie set by hooks.server.ts. Returns true
// when the device most recently observed a signed-in session. Holds no
// secret material — the actual session lives in the Supabase HttpOnly
// cookies. Used to make sensible navigation decisions while offline,
// where the server can't tell us anything.

const COOKIE_NAME = 'ds_auth';

export function hasAuthHint(): boolean {
	if (typeof document === 'undefined') return false;
	const raw = document.cookie;
	if (!raw) return false;
	for (const part of raw.split(';')) {
		const [k, v] = part.trim().split('=');
		if (k === COOKIE_NAME && v === '1') return true;
	}
	return false;
}
