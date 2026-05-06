/**
 * Client-side realtime store. Owns the WebSocket lifecycle:
 *   - opens to WS_PATH using the session cookie (no token plumbing)
 *   - reconnects with exponential backoff
 *   - sends ping every HEARTBEAT_MS, treats pong as proof of life
 *   - exposes runes-state for the UI to bind reactively
 *
 * Designed to be tolerant of the server going away — falls back to /pulse's
 * 30s polling cycle until WS comes back.
 */

import { browser } from '$app/environment';
import type { ClientEvent, Presence, ServerEvent } from '$lib/realtime/protocol';
import { HEARTBEAT_MS, WS_PATH } from '$lib/realtime/protocol';

const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000];
const OUTBOUND_QUEUE_CAP = 50;

export type RealtimeStatus = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'error';

export type LocationUpdate = Extract<ServerEvent, { t: 'location_update' }>['p'];
export type PresenceUpdate = Extract<ServerEvent, { t: 'presence' }>['p'];
export type GhostChange = Extract<ServerEvent, { t: 'ghost_change' }>['p'];

export function createRealtimeClient() {
	let status = $state<RealtimeStatus>('idle');
	let lastError = $state<string | null>(null);
	let lastLocation = $state<LocationUpdate | null>(null);
	let lastGhost = $state<GhostChange | null>(null);
	let lastTap = $state<number | null>(null);
	let presence = $state<Record<string, Presence>>({});

	let ws: WebSocket | null = null;
	let attempt = 0;
	let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
	let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	let stopped = false;
	const outbound: ClientEvent[] = [];

	function clearTimers() {
		if (heartbeatTimer) clearInterval(heartbeatTimer);
		if (reconnectTimer) clearTimeout(reconnectTimer);
		heartbeatTimer = null;
		reconnectTimer = null;
	}

	function flush() {
		if (!ws || ws.readyState !== ws.OPEN) return;
		while (outbound.length) {
			const ev = outbound.shift()!;
			try {
				ws.send(JSON.stringify(ev));
			} catch {
				outbound.unshift(ev);
				return;
			}
		}
	}

	function enqueue(ev: ClientEvent) {
		outbound.push(ev);
		if (outbound.length > OUTBOUND_QUEUE_CAP) outbound.shift();
		flush();
	}

	function scheduleReconnect() {
		if (stopped) return;
		const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
		attempt++;
		status = 'reconnecting';
		reconnectTimer = setTimeout(connect, delay);
	}

	function connect() {
		if (stopped || !browser) return;
		clearTimers();
		status = 'connecting';
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = `${proto}//${location.host}${WS_PATH}`;
		try {
			ws = new WebSocket(url);
		} catch (e) {
			lastError = String(e);
			status = 'error';
			scheduleReconnect();
			return;
		}

		ws.addEventListener('open', () => {
			status = 'open';
			attempt = 0;
			lastError = null;
			flush();
			heartbeatTimer = setInterval(() => {
				enqueue({ t: 'ping', ts: Date.now() });
			}, HEARTBEAT_MS);
		});

		ws.addEventListener('message', (msg) => {
			let ev: ServerEvent;
			try {
				ev = JSON.parse(String(msg.data)) as ServerEvent;
			} catch {
				return;
			}
			switch (ev.t) {
				case 'location_update':
					lastLocation = ev.p;
					return;
				case 'ghost_change':
					lastGhost = ev.p;
					return;
				case 'presence':
					presence = { ...presence, [ev.p.userId]: ev.p.presence };
					return;
				case 'heartbeat_tap':
					lastTap = ev.ts;
					return;
				case 'hello':
				case 'pong':
				case 'typing':
					return;
			}
		});

		ws.addEventListener('close', () => {
			clearTimers();
			ws = null;
			if (!stopped) scheduleReconnect();
		});

		ws.addEventListener('error', () => {
			lastError = 'connection error';
			status = 'error';
		});
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
		start() {
			stopped = false;
			connect();
		},
		stop() {
			stopped = true;
			clearTimers();
			ws?.close();
			ws = null;
			status = 'idle';
		},
		setPresence(p: Presence) {
			enqueue({ t: 'presence', ts: Date.now(), p: { presence: p } });
		},
		setTyping(typing: boolean) {
			enqueue({ t: 'typing', ts: Date.now(), p: { typing } });
		},
		sendHeartbeatTap() {
			enqueue({ t: 'heartbeat_tap', ts: Date.now() });
		}
	};
}

export type RealtimeClient = ReturnType<typeof createRealtimeClient>;
