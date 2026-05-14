import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Guards the runtime contract that the service worker installs the
// /offline fallback into SHELL_CACHE on activation. Regressions here
// silently break the offline experience: a flaky-network user would
// see the browser's "no connection" page instead of our branded
// /offline route. The PWA is the entire product surface, so this is
// covered by a static assertion as well as the e2e run.
describe('service-worker offline precache contract', () => {
	const swPath = join(process.cwd(), 'src/service-worker.ts');
	const offlineRoute = join(process.cwd(), 'src/routes/offline/+page.svelte');

	it('declares OFFLINE_URL = /offline', () => {
		const src = readFileSync(swPath, 'utf8');
		expect(src).toMatch(/const\s+OFFLINE_URL\s*=\s*['"]\/offline['"]/);
	});

	it('includes OFFLINE_URL in SHELL_ASSETS', () => {
		const src = readFileSync(swPath, 'utf8');
		// SHELL_ASSETS now folds in the workbox precache manifest via
		// `Set([...build, ...files, ...WB_URLS, OFFLINE_URL])`. The
		// regex tolerates either the legacy literal array form or the
		// new Set-wrapped form — what we care about is OFFLINE_URL still
		// appearing in the assignment expression.
		expect(src).toMatch(/SHELL_ASSETS\s*=[\s\S]*?OFFLINE_URL[\s\S]*?\)/);
	});

	it('caches SHELL_ASSETS during install', () => {
		const src = readFileSync(swPath, 'utf8');
		// install handler must open SHELL_CACHE and addAll(SHELL_ASSETS)
		expect(src).toMatch(/install/);
		expect(src).toMatch(/caches\.open\(SHELL_CACHE\)/);
		expect(src).toMatch(/addAll\(SHELL_ASSETS\)/);
	});

	it('has a corresponding /offline route in src/routes', () => {
		expect(existsSync(offlineRoute)).toBe(true);
	});

	it('warms /auth/sign-in so it is available offline', () => {
		const src = readFileSync(swPath, 'utf8');
		// /auth/sign-in must be in WARM_ROUTES — the install handler
		// pulls it into HTML_CACHE so a stranded user can still reach
		// the form. (Removing it strands logged-out users on `/offline`
		// even when the form would have rendered fine cached.)
		expect(src).toMatch(/WARM_ROUTES\s*=\s*\[[^\]]*['"]\/auth\/sign-in['"]/);
	});

	it('exempts /auth/sign-in from isPrivatePath', () => {
		const src = readFileSync(swPath, 'utf8');
		// Warming /auth/sign-in is pointless if the fetch handler short-
		// circuits via isPrivatePath() before it can serve the cached
		// copy. Guard the carve-out: the function must compare against
		// '/auth/sign-in' (otherwise every /auth/* path is treated as
		// private and the warm cache is dead weight).
		const fnMatch = src.match(/function\s+isPrivatePath[^}]*}/);
		expect(fnMatch, 'isPrivatePath function not found').not.toBeNull();
		expect(fnMatch![0]).toMatch(/\/auth\/sign-in/);
	});
});

// The pre-paint redirect is now inlined directly into src/app.html
// (was previously external static/route-stub.js). Inlining eliminates
// the script-fetch tick — even SW-cached, an external <script src>
// requires a microtask before execution, leaving a vanishing-but-real
// race window where the body could paint. Inline runs synchronously
// in <head> with zero fetch overhead. CSP `hash` mode auto-hashes it.
//
// If this script loses its ability to read the ds_auth cookie or stops
// handling /welcome, signed-in users will see the welcome hero flash
// on every cold launch (or worse, get stranded on the wrong cached
// page). Keep it under static guard.
describe('app.html pre-paint redirect', () => {
	const appHtmlPath = join(process.cwd(), 'src/app.html');
	const appHtml = readFileSync(appHtmlPath, 'utf8');
	const inlineScript = appHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? '';

	it('has an inline <script> in <head>', () => {
		expect(inlineScript).not.toBe('');
	});

	it('runs only on / and /welcome', () => {
		// Must early-return for any other path so layout-loaded scripts
		// don't double-redirect mid-navigation.
		expect(inlineScript).toMatch(/['"]\/welcome['"]/);
		expect(inlineScript).toMatch(/path !==/);
	});

	it('reads the ds_auth cookie and routes signed-in users to /pulse or /onboarding', () => {
		expect(inlineScript).toMatch(/ds_auth=/);
		expect(inlineScript).toMatch(/['"]\/pulse['"]/);
		expect(inlineScript).toMatch(/['"]\/onboarding['"]/);
	});

	it('does NOT reference the legacy external route-stub.js (must stay inlined)', () => {
		expect(appHtml).not.toMatch(/route-stub\.js/);
	});
});
