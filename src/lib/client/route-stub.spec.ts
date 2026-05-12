import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// The pre-paint redirect is inlined into src/app.html — a returning
// signed-in user opening the PWA cold (online OR offline) gets the
// redirect with zero network/cache fetch. The script reads the
// `ds_auth` cookie (set client-readable by hooks.server.ts) and decides:
//
//   path \ cookie  | (none)        | onboarding   | pulse / "1"
//   ---------------+---------------+--------------+--------------
//   /              | /welcome      | /onboarding  | /pulse
//   /welcome       | (stay)        | /onboarding  | /pulse
//
// This guard kills the welcome-flash whether the cached HTML is served
// online (server 303s) or offline (SW serves cached `/`). Server-online
// flashes are killed separately by /+page.server.ts 303s.

const APP_HTML_PATH = fileURLToPath(new URL('../../app.html', import.meta.url));
const APP_HTML = readFileSync(APP_HTML_PATH, 'utf8');

// Extract the (single) inline pre-paint script from app.html.
function extractStub(): string {
	const m = APP_HTML.match(/<script>([\s\S]*?)<\/script>/);
	if (!m) throw new Error('No inline <script> found in app.html');
	return m[1];
}
const STUB_SRC = extractStub();

interface RunResult {
	pathname: string;
	replaced: string | null;
}

function run({ pathname, cookie }: { pathname: string; cookie: string }): RunResult {
	const result: RunResult = { pathname, replaced: null };
	const fakeLocation = {
		pathname,
		replace(url: string) {
			result.replaced = url;
			result.pathname = url;
		}
	};
	const fakeDocument = { cookie };
	// The stub is an IIFE that touches `location` and `document`. Drop
	// it into a fresh function scope with our mocks shadowing the globals.
	// Using new Function (rather than eval) keeps the stub source text
	// verbatim.
	const fn = new Function('location', 'document', STUB_SRC);
	fn(fakeLocation, fakeDocument);
	return result;
}

describe('route-stub.js', () => {
	describe('on /welcome', () => {
		it('stays put for anonymous visitors (no cookie)', () => {
			const r = run({ pathname: '/welcome', cookie: '' });
			expect(r.replaced).toBeNull();
		});

		it('redirects pulse-cookie users to /pulse', () => {
			const r = run({ pathname: '/welcome', cookie: 'ds_auth=pulse' });
			expect(r.replaced).toBe('/pulse');
		});

		it('redirects onboarding-cookie users to /onboarding', () => {
			const r = run({ pathname: '/welcome', cookie: 'foo=bar; ds_auth=onboarding; baz=qux' });
			expect(r.replaced).toBe('/onboarding');
		});

		it('treats legacy "1" cookie value as pulse for back-compat', () => {
			const r = run({ pathname: '/welcome', cookie: 'ds_auth=1' });
			expect(r.replaced).toBe('/pulse');
		});

		it('treats unknown cookie value as anonymous (no strand)', () => {
			const r = run({ pathname: '/welcome', cookie: 'ds_auth=garbage' });
			expect(r.replaced).toBeNull();
		});
	});

	describe('on /', () => {
		it('routes anonymous visitors to /welcome', () => {
			const r = run({ pathname: '/', cookie: '' });
			expect(r.replaced).toBe('/welcome');
		});

		it('routes pulse-cookie users to /pulse', () => {
			const r = run({ pathname: '/', cookie: 'ds_auth=pulse' });
			expect(r.replaced).toBe('/pulse');
		});

		it('routes onboarding-cookie users to /onboarding', () => {
			const r = run({ pathname: '/', cookie: 'ds_auth=onboarding' });
			expect(r.replaced).toBe('/onboarding');
		});
	});

	describe('on unrelated routes', () => {
		it('does nothing on /pulse', () => {
			const r = run({ pathname: '/pulse', cookie: 'ds_auth=pulse' });
			expect(r.replaced).toBeNull();
		});

		it('does nothing on /auth/sign-in', () => {
			const r = run({ pathname: '/auth/sign-in', cookie: 'ds_auth=onboarding' });
			expect(r.replaced).toBeNull();
		});

		it('does nothing on deep app routes even with cookie', () => {
			const r = run({ pathname: '/calendar', cookie: 'ds_auth=pulse' });
			expect(r.replaced).toBeNull();
		});
	});

	describe('cookie parsing', () => {
		it('handles whitespace between cookies', () => {
			const r = run({ pathname: '/welcome', cookie: 'a=1;  ds_auth=pulse;  b=2' });
			expect(r.replaced).toBe('/pulse');
		});

		it('does not match a substring of another cookie name', () => {
			// `xds_auth` should not be picked up as `ds_auth`.
			const r = run({ pathname: '/welcome', cookie: 'xds_auth=pulse' });
			expect(r.replaced).toBeNull();
		});
	});
});
