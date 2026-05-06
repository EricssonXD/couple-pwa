import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { env } from '$env/dynamic/private';

if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set');

// NOTE: For Cloudflare Workers production deploy, swap this driver for
// `drizzle-orm/neon-serverless` or `drizzle-orm/neon-http` with
// `@neondatabase/serverless` — postgres-js requires a Node/TCP runtime.
const client = postgres(env.DATABASE_URL, { prepare: false });

export const db = drizzle(client, { schema });
