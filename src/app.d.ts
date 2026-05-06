import type { Session, User } from '@supabase/supabase-js';
import type { couple } from '$lib/server/db/schema';

type Couple = typeof couple.$inferSelect;

// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	namespace App {
		interface Platform {
			env: Env;
			ctx: ExecutionContext;
			caches: CacheStorage;
			cf?: IncomingRequestCfProperties;
		}

		interface Locals {
			user?: User;
			session?: Session;
			couple?: Couple;
		}

		// interface Error {}
		// interface PageData {}
		// interface PageState {}
	}
}

export {};
