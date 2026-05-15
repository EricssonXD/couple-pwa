import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: { command: 'npm run build && npm run preview', port: 4173 },
	testDir: 'e2e',
	// prod-smoke.test.ts targets the deployed Cloudflare Worker (and needs
	// pre-seeded auth fixtures + a live DATABASE_URL); it must only run via
	// playwright.prod.config.ts, never against localhost:4173.
	testIgnore: /(prod-smoke|diagnostics-features|pet)\.test\.ts/
});
