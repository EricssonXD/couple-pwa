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

	// R2: reconnect-with-backoff + stale-presence detection + re-broadcast
	// on visibility change. The Supabase client has its own internal
	// socket-level reconnect, but channel-level errors (auth, RLS, server
	// reboot) leave us stuck in 'error'/'reconnecting' until we manually
	// re-subscribe.
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let reconnectAttempt = 0;
	let staleTicker: ReturnType<typeof setInterval> | null = null;
	let lastPresence: Presence = 'online';
	const RECONNECT_BASE_MS = 1_000;
	const RECONNECT_MAX_MS = 30_000;
	const STALE_AFTER_MS = 90_000;
	const STALE_TICK_MS = 15_000;

	function clearReconnect() {
		if (reconnectTimer) {
			clearTimeout(reconnectTimer);
			reconnectTimer = null;
		}
	}

	function scheduleReconnect() {
		if (stopped || reconnectTimer) return;
		const exp = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** reconnectAttempt);
		const jitter = Math.floor(Math.random() * Math.min(1_000, exp / 4));
		reconnectAttempt = Math.min(reconnectAttempt + 1, 6);
		status = 'reconnecting';
		reconnectTimer = setTimeout(() => {
			reconnectTimer = null;
			void rejoin();
		}, exp + jitter);
	}

	async function rejoin() {
		if (stopped) return;
		const c = channel;
		channel = null;
		if (c) {
			try {
				await getSupabaseClient().removeChannel(c);
			} catch {
				/* noop */
			}
		}
		await start();
	}

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
		const now = Date.now();
		for (const [key, metas] of Object.entries(state)) {
			if (!metas?.length) continue;
			// R2: derive freshness from the most recent online_at on each
			// key. If nothing's been heard in STALE_AFTER_MS, surface the
			// peer as 'away' so the UI can dim them. The peer might be
			// truly offline (tab crashed, lost network) — better to show
			// stale than lie about being online.
			let freshest = 0;
			let preferred: Presence | undefined;
			for (const m of metas) {
				const t = m.online_at ? Date.parse(m.online_at) : 0;
				if (Number.isFinite(t) && t > freshest) {
					freshest = t;
					preferred = m.presence;
				}
				if (!preferred && m.presence) preferred = m.presence;
			}
			const stale = freshest > 0 && now - freshest > STALE_AFTER_MS;
			if (stale) next[key] = 'away';
			else if (preferred === 'away') next[key] = 'away';
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
					reconnectAttempt = 0;
					try {
						await channel?.track({
							presence: lastPresence,
							// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-shot ISO timestamp sent over the wire
							online_at: new Date().toISOString()
						});
					} catch (e) {
						lastError = String(e);
					}
				} else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') {
					status = 'error';
					lastError = s;
					scheduleReconnect();
				} else if (s === 'CLOSED') {
					if (!stopped) scheduleReconnect();
					else status = 'idle';
				}
			});

		// R2: stale ticker — recompute presence on a timer so a partner
		// whose tab dies stops looking online once their last online_at
		// exceeds STALE_AFTER_MS. Cheap (a Map walk every 15s).
		if (!staleTicker) staleTicker = setInterval(recomputePresence, STALE_TICK_MS);

		// R2: re-broadcast presence (and force a re-subscribe if dead) when
		// the tab becomes visible. Backgrounded mobile tabs frequently
		// have their socket killed by the OS; without this the partner
		// stays "online" until the next manual interaction.
		installVisibilityHandler();
	}

	let visibilityHandler: (() => void) | null = null;
	function installVisibilityHandler() {
		if (visibilityHandler || typeof document === 'undefined') return;
		visibilityHandler = () => {
			if (stopped || document.visibilityState !== 'visible') return;
			if (!channel || status === 'error' || status === 'reconnecting') {
				clearReconnect();
				reconnectAttempt = 0;
				void rejoin();
				return;
			}
			void channel
				.track({
					presence: lastPresence,
					// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-shot ISO timestamp sent over the wire
					online_at: new Date().toISOString()
				})
				.catch((e: unknown) => {
					lastError = String(e);
				});
		};
		document.addEventListener('visibilitychange', visibilityHandler);
	}
	function uninstallVisibilityHandler() {
		if (visibilityHandler && typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', visibilityHandler);
		}
		visibilityHandler = null;
	}

	async function stop() {
		stopped = true;
		clearReconnect();
		if (staleTicker) {
			clearInterval(staleTicker);
			staleTicker = null;
		}
		uninstallVisibilityHandler();
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
			lastPresence = p;
			if (!channel) return;
			try {
				await channel.track({
					presence: p,
					// eslint-disable-next-line svelte/prefer-svelte-reactivity -- one-shot ISO timestamp sent over the wire
					online_at: new Date().toISOString()
				});
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
