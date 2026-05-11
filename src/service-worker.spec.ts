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
		expect(src).toMatch(/SHELL_ASSETS\s*=\s*\[[^\]]*OFFLINE_URL[^\]]*\]/);
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

// The pre-paint redirect script in static/route-stub.js is the offline
// safety-net for `/` and `/welcome`. If it loses its ability to read
// the ds_auth cookie or stops handling /welcome, signed-in users will
// see the welcome hero flash on every cold launch (or worse, get
// stranded on the wrong cached page). Keep it under static guard.
describe('route-stub.js client-side router', () => {
	const stubPath = join(process.cwd(), 'static/route-stub.js');

	it('exists and is a static asset (cached as part of SHELL_ASSETS via $service-worker `files`)', () => {
		expect(existsSync(stubPath)).toBe(true);
	});

	it('runs only on / and /welcome', () => {
		const src = readFileSync(stubPath, 'utf8');
		// Must early-return for any other path so layout-loaded scripts
		// don't double-redirect mid-navigation.
		expect(src).toMatch(/['"]\/welcome['"]/);
		expect(src).toMatch(/path !==/);
	});

	it('reads the ds_auth cookie and routes signed-in users to /pulse or /onboarding', () => {
		const src = readFileSync(stubPath, 'utf8');
		expect(src).toMatch(/ds_auth=/);
		expect(src).toMatch(/['"]\/pulse['"]/);
		expect(src).toMatch(/['"]\/onboarding['"]/);
	});

	it('is referenced from app.html so it loads synchronously in <head>', () => {
		const appHtml = readFileSync(join(process.cwd(), 'src/app.html'), 'utf8');
		expect(appHtml).toMatch(/route-stub\.js/);
	});
});
