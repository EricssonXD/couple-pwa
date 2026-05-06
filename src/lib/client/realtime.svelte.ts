/**
 * Client-side realtime store, Supabase Realtime edition (Phase M6).
 *
 * Replaces the old WebSocket-based client. The browser supabase singleton
 * holds the underlying realtime socket; we just open one PRIVATE channel per
 * couple. Channel topology:
 *
 *   topic        : couple:<coupleId>
 *   private      : true (M6) — RLS on `realtime.messages` enforces couple
 *                  membership. See `drizzle/manual/0003_realtime_rls.sql`.
 *   broadcast    : { event: '*' } — server pushes location_update +
 *                  ghost_change + heartbeat_tap (clients SELECT-only, the
 *                  RLS policy denies client INSERT to prevent partner-
 *                  spoofing of trusted server events)
 *   presence     : key = userId, value = { presence } — clients can both
 *                  read and write presence on this topic
 *
 * Auth flow (M6 critical path):
 *   1. fetch the current Supabase session
 *   2. await `supabase.realtime.setAuth(access_token)` — required BEFORE
 *      subscribing to a private channel; without it the join is rejected
 *   3. subscribe to `couple:<id>` with `private: true`
 *   4. listen to `auth.onAuthStateChange` and re-call `setAuth` on
 *      `TOKEN_REFRESHED` / `SIGNED_IN` so long-lived sessions keep working
 *      after the JWT rotates (~1h)
 *
 * Heartbeat-tap flow (M6 change): clients no longer hold INSERT permission
 * on the broadcast extension, so taps round-trip via `POST /api/realtime/tap`
 * which validates the caller and re-broadcasts via the service-role REST
 * endpoint (which bypasses RLS).
 *
 * Lifecycle:
 *   - constructor is INERT (safe at component init, including SSR)
 *   - start() opens the channel and subscribes (now async)
 *   - stop() untracks presence + removes channel + clears state
 *
 * Public API (mirrors prior versions where possible):
 *   { status, lastError, lastLocation, lastGhost, lastTap, presence,
 *     start, stop, setPresence, sendHeartbeatTap }
 *
 * Removed in M6: `setTyping` (was unused) and direct client broadcast send.
 */

import { browser } from '$app/environment';
import { getSupabaseClient } from '$lib/client/supabase';
import type { Presence, ServerEvent } from '$lib/realtime/protocol';
import type { RealtimeChannel, Subscription } from '@supabase/supabase-js';

export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'error';

export type LocationUpdate = Extract<ServerEvent, { t: 'location_update' }>['p'];
export type GhostChange = Extract<ServerEvent, { t: 'ghost_change' }>['p'];

export interface RealtimeClientArgs {
	coupleId: string;
	userId: string;
}

interface PresenceMeta {
	presence?: Presence;
	online_at?: string;
}

function topicForCouple(coupleId: string): string {
	return `couple:${coupleId}`;
}

export function createRealtimeClient({ coupleId, userId }: RealtimeClientArgs) {
	let status = $state<RealtimeStatus>('idle');
	let lastError = $state<string | null>(null);
	let lastLocation = $state<LocationUpdate | null>(null);
	let lastGhost = $state<GhostChange | null>(null);
	let lastTap = $state<number | null>(null);
	let lastMomentEvent = $state<{
		t: 'dropped' | 'unlocked' | 'deleted';
		id: string;
		ts: number;
	} | null>(null);
	let presence = $state<Record<string, Presence>>({});

	let channel: RealtimeChannel | null = null;
	let stopped = false;
	let authSub: Subscription | null = null;

	function ingest(ev: ServerEvent) {
		switch (ev.t) {
			case 'location_update':
				lastLocation = ev.p;
				return;
			case 'ghost_change':
				lastGhost = ev.p;
				return;
			case 'heartbeat_tap':
				lastTap = ev.ts;
				return;
			case 'moment_dropped':
				lastMomentEvent = { t: 'dropped', id: ev.p.id, ts: ev.ts };
				return;
			case 'moment_unlocked':
				lastMomentEvent = { t: 'unlocked', id: ev.p.id, ts: ev.ts };
				return;
			case 'moment_deleted':
				lastMomentEvent = { t: 'deleted', id: ev.p.id, ts: ev.ts };
				return;
		}
	}

	function recomputePresence() {
		if (!channel) return;
		const state = channel.presenceState() as Record<string, PresenceMeta[]>;
		const next: Record<string, Presence> = {};
		for (const [key, metas] of Object.entries(state)) {
			if (!metas?.length) continue;
			if (metas.some((m) => m.presence === 'online')) next[key] = 'online';
			else if (metas.some((m) => m.presence === 'away')) next[key] = 'away';
			else next[key] = 'online';
		}
		presence = next;
	}

	async function start() {
		if (!browser || channel || stopped) return;
		status = 'connecting';
		lastError = null;

		const supabase = getSupabaseClient();
		// M6: must seed the realtime socket with the user's JWT BEFORE
		// joining a private channel — Supabase evaluates `auth.uid()` in
		// the `realtime.messages` RLS policy from this token.
		const { data: sessData } = await supabase.auth.getSession();
		const token = sessData.session?.access_token;
		if (!token) {
			status = 'error';
			lastError = 'no_session';
			return;
		}
		await supabase.realtime.setAuth(token);

		// Re-seed realtime auth on token refresh so long-lived sessions
		// don't silently lose access when the JWT rotates (~1h).
		const { data } = supabase.auth.onAuthStateChange((event, session) => {
			if (stopped) return;
			if ((event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') && session?.access_token) {
				void supabase.realtime.setAuth(session.access_token);
			} else if (event === 'SIGNED_OUT') {
				void stop();
			}
		});
		authSub = data.subscription;

		channel = supabase.channel(topicForCouple(coupleId), {
			config: {
				private: true,
				broadcast: { self: false },
				presence: { key: userId }
			}
		});

		channel
			.on('broadcast', { event: '*' }, (msg) => {
				const payload = msg.payload as ServerEvent | undefined;
				if (!payload || typeof payload !== 'object' || !('t' in payload)) return;
				ingest(payload as ServerEvent);
			})
			.on('presence', { event: 'sync' }, () => recomputePresence())
			.on('presence', { event: 'join' }, () => recomputePresence())
			.on('presence', { event: 'leave' }, () => recomputePresence())
			.subscribe(async (s) => {
				if (s === 'SUBSCRIBED') {
					status = 'open';
					try {
						await channel?.track({ presence: 'online', online_at: new Date().toISOString() });
					} catch (e) {
						lastError = String(e);
					}
				} else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
					status = 'error';
					lastError = s;
				} else if (s === 'CLOSED') {
					status = stopped ? 'idle' : 'reconnecting';
				}
			});
	}

	async function stop() {
		stopped = true;
		const c = channel;
		channel = null;
		if (authSub) {
			try {
				authSub.unsubscribe();
			} catch {
				/* noop */
			}
			authSub = null;
		}
		if (c) {
			try {
				await c.untrack();
			} catch {
				/* socket may already be gone */
			}
			try {
				await getSupabaseClient().removeChannel(c);
			} catch {
				/* noop */
			}
		}
		status = 'idle';
		presence = {};
	}

	return {
		get status() {
			return status;
		},
		get lastError() {
			return lastError;
		},
		get lastLocation() {
			return lastLocation;
		},
		get lastGhost() {
			return lastGhost;
		},
		get lastTap() {
			return lastTap;
		},
		get lastMomentEvent() {
			return lastMomentEvent;
		},
		get presence() {
			return presence;
		},
		start,
		stop,
		async setPresence(p: Presence) {
			if (!channel) return;
			try {
				await channel.track({ presence: p, online_at: new Date().toISOString() });
			} catch (e) {
				lastError = String(e);
			}
		},
		async sendHeartbeatTap() {
			// M6: client INSERT on broadcast is denied by RLS. Round-trip
			// through the server endpoint, which validates the caller and
			// re-broadcasts via service-role (RLS-bypassing) REST.
			try {
				const res = await fetch('/api/realtime/tap', { method: 'POST' });
				if (!res.ok) lastError = `tap http ${res.status}`;
			} catch (e) {
				lastError = String(e);
			}
		}
	};
}

export type RealtimeClient = ReturnType<typeof createRealtimeClient>;
