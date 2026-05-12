import { mdsvex } from 'mdsvex';
import adapter from '@sveltejs/adapter-cloudflare';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		csp: {
			// 'hash' works for both prerendered and dynamic responses
			// (nonce mode breaks prerender because nonces are per-request).
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
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
