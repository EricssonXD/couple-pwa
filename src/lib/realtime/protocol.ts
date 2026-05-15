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

import type { PetSnapshot } from '$lib/pet.constants';

export type Presence = 'online' | 'away' | 'offline';

// ─── Server-originated events (sent via REST /realtime/v1/api/broadcast) ──
// All server events are emitted via the service-role REST endpoint and
// re-broadcast on the private `couple:<id>` topic. Clients can only LISTEN
// to broadcast on this topic (RLS denies client INSERT) — see M6 plan.
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
			t: 'heartbeat_tap';
			ts: number;
			p: { userId: string };
	  }
	| {
			t: 'moment_dropped';
			ts: number;
			p: {
				id: string;
				authorId: string;
				lat: number;
				lon: number;
				radiusM: number;
				createdAt: string;
				expiresAt: string | null;
			};
	  }
	| {
			t: 'moment_unlocked';
			ts: number;
			p: { id: string; unlockedBy: string; unlockedAt: string };
	  }
	| {
			t: 'moment_deleted';
			ts: number;
			p: { id: string };
	  }
	| {
			// R4: emitted on a successful PATCH so peers can refresh body /
			// radius / expiresAt without polling. Body is intentionally
			// omitted — the partner re-fetches via /api/moments to enforce
			// the unlocked-by gate.
			t: 'moment_updated';
			ts: number;
			p: { id: string; updatedAt: string; updatedBy: string };
	  }
	| {
			// F5: partner-mood badge live update. `setAt` is server-truth
			// for ordering / "stale mood" detection on the receiver.
			t: 'mood_change';
			ts: number;
			p: {
				userId: string;
				mood: 'joyful' | 'happy' | 'neutral' | 'sad' | 'upset';
				setAt: string;
			};
	  }
	| {
			// F7: chat message just sent by `senderId`. Body is included
			// here because the channel is private + RLS-scoped to couple
			// members; lockscreen push payloads do NOT carry the body
			// (mirrors F16 lockscreen-privacy stance).
			t: 'chat_message';
			ts: number;
			p: {
				id: string;
				senderId: string;
				body: string;
				createdAt: string;
			};
	  }
	| {
			// Pet system: full snapshot broadcast on every server-side
			// pet write. Snapshot-on-commit (no deltas) — see
			// pet-system.md §"Real-time sync". Receiver collapses bursts
			// via RAF + (pet.version, wallet.version) version-gate.
			t: 'pet_state';
			ts: number;
			p: PetSnapshot;
	  }
	| {
			// F11: a partner just finalized an hourly clip. Metadata only —
			// receivers must refetch /api/hourly/day to obtain a fresh,
			// short-TTL signed playback URL. Including the signed URL in
			// the broadcast would risk leakage via realtime logs / client
			// telemetry.
			t: 'hourly_clip';
			ts: number;
			p: { id: string; userId: string; hourBucket: string };
	  }
	| {
			// F11: a partner just set/updated their hourly mood. Subject
			// to the 24h cross-partner visibility window enforced in the
			// service + RLS — clients should still re-query if they care
			// about authoritative state.
			t: 'hourly_mood';
			ts: number;
			p: {
				userId: string;
				hourBucket: string;
				mood: 'joyful' | 'happy' | 'neutral' | 'sad' | 'upset';
			};
	  };

// ─── Client-originated events ────────────────────────────────────────────
// `presence` is NOT a broadcast — it goes through the Supabase Presence API
// (channel.track / channel.untrack), which under M6 is the only client
// INSERT path allowed on `realtime.messages` for couple topics.
//
// Heartbeat-tap is HTTP-mediated (POST /api/realtime/tap) so the server can
// validate the caller before re-broadcasting; clients no longer hold INSERT
// permission on the broadcast extension to prevent partner-spoofing of
// server events. Hence this union is currently empty — kept as an extension
// point for future client-direct broadcast events (none planned).
export type ClientEvent = never;
