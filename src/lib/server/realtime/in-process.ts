/**
 * In-process RealtimeAdapter. Lives in the Node process Vite spawns for
 * dev, and (for now) in any single-instance prod deploy. Will be replaced
 * by a Durable Object adapter at Phase 9 ship — see ./adapter.ts.
 *
 * Also hosts the connection ledger used by the WS upgrade handler so it
 * can register/deregister sockets and apply heartbeat liveness checks.
 */

import type { WebSocket } from 'ws';
import type { ClientEvent, Presence, ServerEvent } from '$lib/realtime/protocol';
import { DEAD_AFTER_MS, HEARTBEAT_MS } from '$lib/realtime/protocol';
import type { RealtimeAdapter } from './adapter';

export interface Connection {
	ws: WebSocket;
	userId: string;
	coupleId: string;
	presence: Presence;
	lastSeen: number;
}

const rooms = new Map<string, Set<Connection>>();
const userPresence = new Map<string, Presence>(); // userId -> aggregated presence

function send(conn: Connection, ev: ServerEvent) {
	if (conn.ws.readyState !== conn.ws.OPEN) return;
	try {
		conn.ws.send(JSON.stringify(ev));
	} catch {
		/* socket dying, sweeper will clean it up */
	}
}

function broadcast(coupleId: string, ev: ServerEvent, exceptUserId?: string) {
	const room = rooms.get(coupleId);
	if (!room) return;
	for (const conn of room) {
		if (exceptUserId && conn.userId === exceptUserId) continue;
		send(conn, ev);
	}
}

export const inProcessAdapter: RealtimeAdapter = {
	broadcastToCouple(coupleId, event, opts) {
		broadcast(coupleId, event, opts?.exceptUserId);
	},
	roomSize(coupleId) {
		return rooms.get(coupleId)?.size ?? 0;
	}
};

export function aggregatePresence(coupleId: string, userId: string): Presence {
	const room = rooms.get(coupleId);
	if (!room) return 'offline';
	let best: Presence = 'offline';
	for (const c of room) {
		if (c.userId !== userId) continue;
		if (c.presence === 'online') return 'online';
		if (c.presence === 'away') best = 'away';
	}
	return best;
}

function announcePresence(conn: Connection) {
	const next = aggregatePresence(conn.coupleId, conn.userId);
	const prev = userPresence.get(conn.userId);
	if (prev === next) return;
	userPresence.set(conn.userId, next);
	broadcast(
		conn.coupleId,
		{ t: 'presence', ts: Date.now(), p: { userId: conn.userId, presence: next } },
		conn.userId
	);
}

/**
 * Register a freshly-upgraded socket. Wires up message routing, heartbeat
 * tracking, and tear-down. Caller must have already authenticated and
 * resolved the user's couple.
 */
export function registerConnection(ws: WebSocket, userId: string, coupleId: string) {
	const conn: Connection = {
		ws,
		userId,
		coupleId,
		presence: 'online',
		lastSeen: Date.now()
	};
	let room = rooms.get(coupleId);
	if (!room) {
		room = new Set();
		rooms.set(coupleId, room);
	}
	room.add(conn);

	send(conn, { t: 'hello', ts: Date.now(), p: { userId, coupleId } });

	// Tell the new socket about every other user already in the room — without
	// this, a late-joining partner would never see the existing online state.
	const seen = new Set<string>();
	for (const other of room) {
		if (other.userId === userId) continue;
		if (seen.has(other.userId)) continue;
		seen.add(other.userId);
		const p = aggregatePresence(coupleId, other.userId);
		send(conn, { t: 'presence', ts: Date.now(), p: { userId: other.userId, presence: p } });
	}

	announcePresence(conn);

	ws.on('message', (raw) => {
		conn.lastSeen = Date.now();
		let msg: ClientEvent;
		try {
			msg = JSON.parse(String(raw)) as ClientEvent;
		} catch {
			return;
		}
		switch (msg.t) {
			case 'ping':
				send(conn, { t: 'pong', ts: Date.now() });
				return;
			case 'presence':
				conn.presence = msg.p.presence;
				announcePresence(conn);
				return;
			case 'typing':
				broadcast(
					coupleId,
					{ t: 'typing', ts: Date.now(), p: { userId, typing: msg.p.typing } },
					userId
				);
				return;
			case 'heartbeat_tap':
				broadcast(coupleId, { t: 'heartbeat_tap', ts: Date.now(), p: { userId } }, userId);
				return;
		}
	});

	const cleanup = () => {
		const r = rooms.get(coupleId);
		if (r) {
			r.delete(conn);
			if (r.size === 0) rooms.delete(coupleId);
		}
		// Last socket for this user gone? Mark offline + announce.
		const stillThere = Array.from(rooms.get(coupleId) ?? []).some((c) => c.userId === userId);
		if (!stillThere) {
			userPresence.set(userId, 'offline');
			broadcast(
				coupleId,
				{ t: 'presence', ts: Date.now(), p: { userId, presence: 'offline' } },
				userId
			);
		}
	};
	ws.on('close', cleanup);
	ws.on('error', cleanup);
}

// ─── Liveness sweeper ─────────────────────────────────────────────────────
// Runs once per HEARTBEAT_MS. Drops sockets that haven't ping'd in DEAD_AFTER_MS.
let sweeperStarted = false;
export function ensureSweeper() {
	if (sweeperStarted) return;
	sweeperStarted = true;
	setInterval(() => {
		const cutoff = Date.now() - DEAD_AFTER_MS;
		for (const room of rooms.values()) {
			for (const conn of room) {
				if (conn.lastSeen < cutoff) {
					try {
						conn.ws.terminate();
					} catch {
						/* noop */
					}
				}
			}
		}
	}, HEARTBEAT_MS).unref?.();
}
