/**
 * Client-side realtime store, Supabase Realtime edition (Phase M4).
 *
 * Replaces the old WebSocket-based client. The browser supabase singleton
 * holds the underlying realtime socket; we just open one channel per
 * couple. Channel topology:
 *
 *   topic        : couple:<coupleId>
 *   broadcast    : { event: '*' } — server pushes location_update +
 *                  ghost_change; clients push heartbeat_tap + typing
 *   presence     : key = userId, value = { presence }
 *
 * Privacy: channels are public (private: false) for MVP. Topic uuid is
 * the access secret. See plan.md §M6 for the upgrade path.
 *
 * Lifecycle:
 *   - constructor is INERT (safe at component init, including SSR)
 *   - start() opens the channel and subscribes
 *   - stop() untracks presence + removes channel + clears state
 *
 * Public API surface mirrors the old WS client so consumers (pulse) keep
 * working: { status, lastError, lastLocation, lastGhost, lastTap,
 * presence, start, stop, setPresence, setTyping, sendHeartbeatTap }.
 */

import { browser } from '$app/environment';
import { getSupabaseClient } from '$lib/client/supabase';
import type { ClientEvent, Presence, ServerEvent } from '$lib/realtime/protocol';
import type { RealtimeChannel } from '@supabase/supabase-js';

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
	let presence = $state<Record<string, Presence>>({});

	let channel: RealtimeChannel | null = null;
	let stopped = false;

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
			case 'typing':
				// not displayed yet — kept for future chat surface
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

	function start() {
		if (!browser || channel || stopped) return;
		status = 'connecting';
		lastError = null;

		const supabase = getSupabaseClient();
		channel = supabase.channel(topicForCouple(coupleId), {
			config: {
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

	async function sendBroadcast(event: ClientEvent) {
		if (!channel || status !== 'open') return;
		try {
			await channel.send({ type: 'broadcast', event: event.t, payload: event });
		} catch (e) {
			lastError = String(e);
		}
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
		setTyping(typing: boolean) {
			void sendBroadcast({ t: 'typing', ts: Date.now(), p: { userId, typing } });
		},
		sendHeartbeatTap() {
			void sendBroadcast({ t: 'heartbeat_tap', ts: Date.now(), p: { userId } });
		}
	};
}

export type RealtimeClient = ReturnType<typeof createRealtimeClient>;
