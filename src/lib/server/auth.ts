import { betterAuth } from 'better-auth/minimal';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { passkey } from '@better-auth/passkey';
import { env } from '$env/dynamic/private';
import { getRequestEvent } from '$app/server';
import { db } from '$lib/server/db';

const rpURL = env.ORIGIN ?? 'http://localhost:5173';
const rpID = (() => {
	try {
		return new URL(rpURL).hostname;
	} catch {
		return 'localhost';
	}
})();

export const auth = betterAuth({
	baseURL: env.ORIGIN,
	secret: env.BETTER_AUTH_SECRET,
	database: drizzleAdapter(db, { provider: 'pg' }),
	emailAndPassword: { enabled: true },
	socialProviders: {
		google: {
			clientId: env.GOOGLE_CLIENT_ID ?? '',
			clientSecret: env.GOOGLE_CLIENT_SECRET ?? ''
		}
	},
	plugins: [
		passkey({
			rpName: 'DuoSync',
			rpID,
			origin: rpURL
		}),
		sveltekitCookies(getRequestEvent) // make sure this is the last plugin in the array
	]
});
