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
});
