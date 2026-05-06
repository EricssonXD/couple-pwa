/**
 * Wire protocol shared by the server-side broadcast emitter and the
 * Supabase Realtime client.
 *
 * Originally a WebSocket protocol (Phase 9 in-process WS) — now used as
 * the payload shape for Supabase Realtime broadcast messages. The
 * `event` name on the broadcast envelope mirrors `t`, and the full event
 * is sent as `payload` so the client switches on `payload.t` exactly as
 * before.
 *
 * Wire envelope: { t: type, ts: epoch_ms, p?: payload }
 * Short keys keep idle frames tiny.
 */

export type Presence = 'online' | 'away' | 'offline';

// ─── Server-originated events (sent via REST /realtime/v1/api/broadcast) ──
export type ServerEvent =
	| {
			t: 'location_update';
			ts: number;
			p: {
				userId: string;
				distanceM: number | null;
				bucket: 'together' | 'near' | 'same_city' | 'far' | 'unknown';
				batteryPct: number | null;
				charging: boolean | null;
				capturedAt: string;
			};
	  }
	| {
			t: 'ghost_change';
			ts: number;
			p: { userId: string; ghost: boolean };
	  }
	| {
			t: 'typing';
			ts: number;
			p: { userId: string; typing: boolean };
	  }
	| {
			t: 'heartbeat_tap';
			ts: number;
			p: { userId: string };
	  };

// ─── Client-originated events (sent via channel.send broadcast) ───────────
// NOTE: `presence` is NOT a broadcast — it goes through the Supabase
// Presence API (channel.track / channel.untrack).
export type ClientEvent =
	| { t: 'typing'; ts: number; p: { userId: string; typing: boolean } }
	| { t: 'heartbeat_tap'; ts: number; p: { userId: string } };
