/**
 * Supabase Realtime adapter (Phase M4) — empty stub.
 *
 * Will use `supabase.channel(\`couple:\${coupleId}\`)` with broadcast events
 * to fan out server-originated events to all clients subscribed to the
 * couple's channel. Persistent events (chat messages, geo-moments, ghost
 * mode changes) flow via Postgres CDC subscriptions on the client side
 * instead of explicit broadcast.
 *
 * The room-size concept changes: with Supabase Realtime there are no
 * per-process socket maps. We'll either expose `presenceState()` from a
 * channel held by an admin client, or just return -1 / drop the method
 * from the contract for prod.
 *
 * Implementation deferred to Phase M4 — once Supabase project credentials
 * are available we can verify the broadcast roundtrip end-to-end.
 */

import type { RealtimeAdapter } from './adapter';
import type { ServerEvent } from '$lib/realtime/protocol';

export function createSupabaseRealtimeAdapter(): RealtimeAdapter {
	return {
		broadcastToCouple(coupleId: string, _event: ServerEvent): Promise<void> {
			// TODO(M4): obtain admin Supabase client, send broadcast to
			// channel(`couple:${coupleId}`).send({ type: 'broadcast', event: _event.type, payload: _event }).
			throw new Error(
				`createSupabaseRealtimeAdapter: broadcast for couple ${coupleId} not implemented yet (Phase M4).`
			);
		},
		roomSize(_coupleId: string): number {
			// TODO(M4): call channel.presenceState() and count entries; or drop from interface.
			return -1;
		}
	};
}
