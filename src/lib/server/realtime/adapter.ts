/**
 * RealtimeAdapter — abstraction over "broadcast a server event to every
 * connection in a couple room".
 *
 * In dev (Node + Vite) we use an in-process Map; in prod (Cloudflare) we'll
 * route to a Durable Object so any worker instance can fan out. Both impls
 * implement this interface so callers stay identical.
 */

import type { ServerEvent } from '$lib/realtime/protocol';

export interface RealtimeAdapter {
	/** Fan out an event to every socket in the couple, optionally excluding
	 * one user id (e.g. don't echo my own presence change back to me). */
	broadcastToCouple(
		coupleId: string,
		event: ServerEvent,
		opts?: { exceptUserId?: string }
	): Promise<void> | void;

	/** Number of sockets currently registered in the room. Useful for tests
	 * + the upcoming presence ledger. */
	roomSize(coupleId: string): number;
}
