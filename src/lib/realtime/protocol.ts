/**
 * Wire protocol shared by the WebSocket server and client. Keep this file
 * free of runtime imports — both the in-process adapter and the future
 * Durable Object impl will pull from here.
 *
 * Wire envelope: { t: type, ts: epoch_ms, p?: payload }
 * Short keys keep idle heartbeat frames tiny.
 */

export type Presence = 'online' | 'away' | 'offline';

// ─── Server → Client events ───────────────────────────────────────────────
export type ServerEvent =
	| {
			t: 'hello';
			ts: number;
			// User the server thinks you are (for client sanity-check).
			p: { userId: string; coupleId: string };
	  }
	| {
			t: 'presence';
			ts: number;
			p: { userId: string; presence: Presence };
	  }
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
	  }
	| { t: 'pong'; ts: number };

// ─── Client → Server events ───────────────────────────────────────────────
export type ClientEvent =
	| { t: 'ping'; ts: number }
	| { t: 'presence'; ts: number; p: { presence: Presence } }
	| { t: 'typing'; ts: number; p: { typing: boolean } }
	| { t: 'heartbeat_tap'; ts: number };

export const WS_PATH = '/ws/couple';
export const HEARTBEAT_MS = 30_000;
export const DEAD_AFTER_MS = HEARTBEAT_MS * 2; // 60s
