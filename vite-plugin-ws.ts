/**
 * Vite plugin that adds a WebSocket upgrade handler at WS_PATH for `bun run dev`.
 *
 * Production runs on Cloudflare Workers — the equivalent upgrade handling
 * there will live inside the Worker fetch handler with `webSocketPair` and
 * route into a Durable Object. This plugin is dev-only.
 *
 * Auth: re-validates the Better-Auth session cookie on the upgrade request
 * (no extra token endpoint needed). If the user has no active couple, the
 * upgrade is rejected with 409.
 *
 * NOTE on imports: server modules ($env, $lib aliases, drizzle relations)
 * are loaded LAZILY via Vite's ssrLoadModule. Importing them at the top of
 * vite.config.ts would fail because $env only resolves inside SvelteKit's
 * dev pipeline. WS_PATH is a plain const so it's safe to import directly.
 */

import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage } from 'node:http';
import { WebSocketServer } from 'ws';
import { WS_PATH } from './src/lib/realtime/protocol';

function headersFromReq(req: IncomingMessage): Headers {
	const h = new Headers();
	for (const [k, v] of Object.entries(req.headers)) {
		if (typeof v === 'string') h.set(k, v);
		else if (Array.isArray(v)) h.set(k, v.join(', '));
	}
	return h;
}

async function loadDeps(server: ViteDevServer) {
	const [authMod, dbMod, schemaMod, rtMod, drizzleMod] = await Promise.all([
		server.ssrLoadModule('/src/lib/server/auth.ts'),
		server.ssrLoadModule('/src/lib/server/db/index.ts'),
		server.ssrLoadModule('/src/lib/server/db/schema.ts'),
		server.ssrLoadModule('/src/lib/server/realtime/in-process.ts'),
		import('drizzle-orm')
	]);
	return {
		auth: authMod.auth as { api: { getSession: (a: { headers: Headers }) => Promise<unknown> } },
		db: dbMod.db as {
			select: () => {
				from: (t: unknown) => { where: (w: unknown) => { limit: (n: number) => Promise<unknown[]> } };
			};
		},
		couple: schemaMod.couple as Record<string, unknown>,
		registerConnection: rtMod.registerConnection as (
			ws: import('ws').WebSocket,
			userId: string,
			coupleId: string
		) => void,
		eq: drizzleMod.eq,
		or: drizzleMod.or,
		and: drizzleMod.and
	};
}

export function wsServerPlugin(): Plugin {
	const wss = new WebSocketServer({ noServer: true });

	return {
		name: 'duosync-ws-server',
		apply: 'serve',
		configureServer(server) {
			if (!server.httpServer) return;
			server.httpServer.on('upgrade', (req, socket, head) => {
				try {
					const url = new URL(req.url ?? '/', 'http://localhost');
					if (url.pathname !== WS_PATH) return; // let other handlers (HMR) take it

					void (async () => {
						try {
							const deps = await loadDeps(server);
							const session = (await deps.auth.api.getSession({
								headers: headersFromReq(req)
							})) as { user?: { id: string } } | null;
							if (!session?.user) {
								socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
								socket.destroy();
								return;
							}
							const userId = session.user.id;
							const c = deps.couple as {
								id: unknown;
								status: unknown;
								partnerA: unknown;
								partnerB: unknown;
							};
							// drizzle-orm types are too narrow for the dynamic Record cast above;
							// these eq/or/and calls are runtime-correct.
							const eq = deps.eq as (a: unknown, b: unknown) => unknown;
							const or = deps.or as (...args: unknown[]) => unknown;
							const and = deps.and as (...args: unknown[]) => unknown;
							const rows = (await deps.db
								.select()
								.from(deps.couple)
								.where(
									and(
										eq(c.status, 'active'),
										or(eq(c.partnerA, userId), eq(c.partnerB, userId))
									)
								)
								.limit(1)) as Array<{ id: string }>;
							if (!rows.length) {
								socket.write('HTTP/1.1 409 Conflict\r\n\r\n');
								socket.destroy();
								return;
							}
							wss.handleUpgrade(req, socket, head, (ws) => {
								deps.registerConnection(ws, userId, rows[0].id);
							});
						} catch (e) {
							try {
								socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
								socket.destroy();
							} catch {
								/* socket already gone */
							}
							// eslint-disable-next-line no-console
							console.error('[ws] upgrade error', e);
						}
					})();
				} catch (e) {
					// eslint-disable-next-line no-console
					console.error('[ws] outer error', e);
				}
			});
		}
	};
}
