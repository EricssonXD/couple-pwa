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
	const src = readFileSync(swPath, 'utf8');

	it('declares OFFLINE_URL = /offline', () => {
		expect(src).toMatch(/const\s+OFFLINE_URL\s*=\s*['"]\/offline['"]/);
	});

	it('includes OFFLINE_URL in SHELL_ASSETS', () => {
		// SHELL_ASSETS now folds in the workbox precache manifest via
		// `Set([...build, ...files, ...WB_URLS, OFFLINE_URL])`. The
		// regex tolerates either the legacy literal array form or the
		// new Set-wrapped form — what we care about is OFFLINE_URL still
		// appearing in the assignment expression.
		expect(src).toMatch(/SHELL_ASSETS\s*=[\s\S]*?OFFLINE_URL[\s\S]*?\)/);
	});

	it('caches SHELL_ASSETS during install', () => {
		// install handler must open SHELL_CACHE and addAll(SHELL_ASSETS)
		expect(src).toMatch(/install/);
		expect(src).toMatch(/caches\.open\(SHELL_CACHE\)/);
		expect(src).toMatch(/addAll\(SHELL_ASSETS\)/);
	});

	it('has a corresponding /offline route in src/routes', () => {
		expect(existsSync(offlineRoute)).toBe(true);
	});

	it('warms /auth/sign-in so it is available offline', () => {
		// /auth/sign-in must be in WARM_ROUTES — the install handler
		// pulls it into HTML_CACHE so a stranded user can still reach
		// the form. (Removing it strands logged-out users on `/offline`
		// even when the form would have rendered fine cached.)
		expect(src).toMatch(/WARM_ROUTES\s*=\s*\[[^\]]*['"]\/auth\/sign-in['"]/);
	});

	it('exempts /auth/sign-in from isPrivatePath', () => {
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

// Workbox / vite-plugin-pwa migration contract (P2 + P3).
//
// The SW is built via vite-plugin-pwa's `injectManifest` strategy —
// workbox-build does a STRING replacement of the literal token
// `self.__WB_MANIFEST` at build time. Anything that hides that token
// behind a typed cast or a re-export breaks the build with "Unable to
// find a place to inject the manifest". Plus we need a few workbox
// helpers wired up so the migration stays meaningful (otherwise we'd
// just be paying the dependency cost without using it).
describe('service-worker workbox / vite-pwa contract', () => {
	const swPath = join(process.cwd(), 'src/service-worker.ts');
	const src = readFileSync(swPath, 'utf8');

	it('contains the literal self.__WB_MANIFEST token (workbox-build needs to find it)', () => {
		// Any abstraction that hides this token (e.g. const m =
		// self.__WB_MANIFEST then precacheAndRoute(m)) is fine for the
		// runtime but must STILL leave the literal string in source —
		// workbox-build's regex string-scans the file. Guard it.
		expect(src).toMatch(/self\s*\.\s*__WB_MANIFEST|__WB_MANIFEST/);
	});

	it('imports precacheAndRoute + cleanupOutdatedCaches from workbox-precaching', () => {
		expect(src).toMatch(
			/from\s+['"]workbox-precaching['"][^;]*precacheAndRoute|precacheAndRoute[\s\S]*?from\s+['"]workbox-precaching['"]/
		);
		expect(src).toMatch(/cleanupOutdatedCaches/);
	});

	it('calls precacheAndRoute(__WB_MANIFEST) and cleanupOutdatedCaches() at top level', () => {
		expect(src).toMatch(/precacheAndRoute\(/);
		expect(src).toMatch(/cleanupOutdatedCaches\(\)/);
	});

	it('registers at least one workbox runtime route via registerRoute', () => {
		// We adopted workbox routing for images + generic same-origin
		// GETs; HTML/data still ride the custom branch (navigationPreload
		// + /offline fallback aren't expressible in workbox primitives).
		const calls = src.match(/registerRoute\(/g) ?? [];
		expect(calls.length, 'expected ≥1 registerRoute call').toBeGreaterThanOrEqual(1);
	});

	it('uses StaleWhileRevalidate strategy for runtime routes', () => {
		// SWR matches the user-visible behavior contract: cache wins
		// instantly, network refreshes in background. NetworkFirst would
		// regress the "feels native" tab-switch UX.
		expect(src).toMatch(/new\s+StaleWhileRevalidate\(/);
	});

	it('whitelists workbox- caches in the activate GC sweep', () => {
		// Without this guard, the activate handler's "delete every cache
		// not in RUNTIME_CACHES" loop wipes workbox-precache-v2-* on
		// every activation, undoing precacheAndRoute() and forcing a
		// full re-precache on the next request. Belt-and-suspenders.
		expect(src).toMatch(/WORKBOX_CACHE_PREFIX\s*=\s*['"]workbox-['"]/);
		expect(src).toMatch(/startsWith\(WORKBOX_CACHE_PREFIX\)/);
	});

	it('preserves the SKIP_WAITING contract (skipWaiting + clients.claim)', () => {
		// vite-pwa's registerSW.onNeedRefresh is what tells the page a
		// new SW exists, but the apply step is still our hand-rolled
		// SKIP_WAITING postMessage → message handler. If this handler
		// stops calling clients.claim(), iOS standalone PWAs deadlock
		// in an apply-loop (see comment block at top of file).
		const handlerMatch = src.match(/event\.data === ['"]SKIP_WAITING['"][\s\S]{0,800}/);
		expect(handlerMatch, 'SKIP_WAITING handler not found').not.toBeNull();
		expect(handlerMatch![0]).toMatch(/skipWaiting\(\)/);
		expect(handlerMatch![0]).toMatch(/clients\.claim\(\)/);
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
