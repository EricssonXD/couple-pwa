import { mdsvex } from 'mdsvex';
import adapter from '@sveltejs/adapter-cloudflare';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		// vite-plugin-pwa (configured in vite.config.ts) owns the service
		// worker lifecycle — registration, update detection, prompt API.
		// Disable SvelteKit's built-in registration so the two don't fight.
		// `src/service-worker.ts` is still the SW source; vite-pwa builds
		// it via `injectManifest` strategy.
		serviceWorker: {
			register: false
		},
		csp: {
			// 'hash' works for both prerendered and dynamic responses
			// (nonce mode breaks prerender because nonces are per-request).
			//
			// vite-plugin-pwa migration audit (P4):
			//   - injectManifest mode bundles workbox INTO src/service-worker.ts,
			//     so the built /service-worker.js has zero importScripts() calls
			//     and no requests to storage.googleapis.com/workbox-*. worker-src
			//     'self' is sufficient — no CDN allowlist needed.
			//   - injectRegister:false (vite.config.ts) means we register manually
			//     via $lib/pwa/register.ts, and no /registerSW.js asset is emitted.
			//     virtual:pwa-register is tree-shaken into the regular _app/* JS
			//     bundle, covered by script-src 'self'.
			//   - no new img/style/font origins introduced.
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				// Cloudflare Web Analytics auto-injects beacon.min.js at the edge —
				// must be allowlisted or every page console-errors on load.
				'script-src': ['self', 'https://static.cloudflareinsights.com'],
				'style-src': ['self', 'https://fonts.googleapis.com', 'unsafe-inline'],
				'font-src': ['self', 'https://fonts.gstatic.com', 'data:'],
				'img-src': [
					'self',
					'data:',
					'blob:',
					'https://*.tile.openstreetmap.org',
					'https://*.basemaps.cartocdn.com'
				],
				// Supabase Realtime uses wss:; HTTPS for REST/auth/storage.
				// We don't pin a single host — the URL comes from env at
				// runtime (PUBLIC_SUPABASE_URL) and could be a custom
				// project subdomain. Allowing https:/wss: scheme-wide is
				// the pragmatic choice; combined with default-src 'self'
				// the supply-chain surface is still tight.
				'connect-src': ['self', 'https:', 'wss:'],
				// F11 hourly diary: short clips are uploaded to Supabase Storage
				// and played back via signed URLs on arbitrary https hosts.
				// blob: covers the local preview <video src={URL.createObjectURL}>.
				'media-src': ['self', 'blob:', 'https:'],
				'frame-ancestors': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'manifest-src': ['self'],
				'worker-src': ['self'],
				'object-src': ['none']
			}
		}
	},
	preprocess: [mdsvex()],
	extensions: ['.svelte', '.svx']
};

export default config;
