/**
 * End-to-end realtime smoke test.
 * Uses /tmp/duosync-test.json (from seed-test-couple.ts) to:
 *   1. Open a WS as alice and a WS as bob.
 *   2. POST /api/location/ping as alice → assert bob receives location_update.
 *   3. POST /api/location/ghost as alice → assert bob receives ghost_change.
 *   4. Send heartbeat_tap from alice WS → assert bob receives heartbeat_tap.
 *   5. Send presence=away from alice → assert bob receives presence event.
 *
 * Usage:
 *   bun run scripts/test-realtime.ts /tmp/duosync-test.json
 */

import { readFileSync } from 'node:fs';
import WebSocket from 'ws';

interface Seed {
	origin: string;
	coupleId: string;
	alice: { userId: string; cookie: string };
	bob: { userId: string; cookie: string };
}

const path = process.argv[2] ?? '/tmp/duosync-test.json';
const seed = JSON.parse(readFileSync(path, 'utf8')) as Seed;
const wsUrl = seed.origin.replace(/^http/, 'ws') + '/ws/couple';

interface Inbox {
	all: unknown[];
	wait: <T>(pred: (e: { t: string; p?: unknown }) => boolean, ms?: number) => Promise<T>;
}

function openSocket(label: string, cookie: string): Promise<{ ws: WebSocket; inbox: Inbox }> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(wsUrl, { headers: { cookie } });
		const all: unknown[] = [];
		const waiters: Array<{
			pred: (e: { t: string }) => boolean;
			resolve: (v: unknown) => void;
			reject: (e: Error) => void;
			to: NodeJS.Timeout;
		}> = [];

		const inbox: Inbox = {
			all,
			wait(pred, ms = 4000) {
				// Check messages already received before subscribing — otherwise we
				// race the WS open vs. the test-runner's await openSocket().
				const existing = all.find((e) => pred(e as { t: string; p?: unknown }));
				if (existing) return Promise.resolve(existing as never);
				return new Promise<never>((res, rej) => {
					const to = setTimeout(() => {
						const i = waiters.findIndex((w) => w.to === to);
						if (i !== -1) waiters.splice(i, 1);
						rej(new Error(`[${label}] timeout waiting for event`));
					}, ms);
					waiters.push({ pred, resolve: res as (v: unknown) => void, reject: rej, to });
				}) as never;
			}
		};

		ws.on('message', (raw) => {
			let ev: { t: string };
			try {
				ev = JSON.parse(String(raw));
			} catch {
				return;
			}
			all.push(ev);
			console.log(`  [${label} ←]`, JSON.stringify(ev));
			for (let i = waiters.length - 1; i >= 0; i--) {
				if (waiters[i].pred(ev)) {
					clearTimeout(waiters[i].to);
					waiters[i].resolve(ev);
					waiters.splice(i, 1);
				}
			}
		});
		ws.once('open', () => resolve({ ws, inbox }));
		ws.once('error', reject);
	});
}

async function postJson(label: string, path: string, cookie: string, body: unknown) {
	const res = await fetch(seed.origin + path, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie },
		body: JSON.stringify(body)
	});
	const text = await res.text();
	console.log(`  [${label} POST ${path}] → ${res.status}`);
	if (!res.ok) throw new Error(`${path} failed: ${res.status} ${text}`);
	return text;
}

async function main() {
	console.log('# 1. Open both sockets');
	const [aliceConn, bobConn] = await Promise.all([
		openSocket('alice', seed.alice.cookie),
		openSocket('bob', seed.bob.cookie)
	]);

	console.log('# 2. Wait for hello on both sides');
	await Promise.all([
		aliceConn.inbox.wait((e) => e.t === 'hello'),
		bobConn.inbox.wait((e) => e.t === 'hello')
	]);

	console.log('# 3. Bob should see alice come online (presence)');
	const presenceP = bobConn.inbox.wait<{ p: { userId: string; presence: string } }>(
		(e) => e.t === 'presence' && (e as { p: { userId: string } }).p.userId === seed.alice.userId
	);
	await presenceP;

	console.log('# 4. Alice posts a location ping → bob expects location_update');
	const updP = bobConn.inbox.wait<{ p: { userId: string; distanceM: number | null } }>(
		(e) => e.t === 'location_update'
	);
	await postJson('alice', '/api/location/ping', seed.alice.cookie, {
		lat: 22.3193,
		lon: 114.1694,
		accuracyM: 10,
		batteryPct: 88,
		charging: false,
		capturedAt: new Date().toISOString()
	});
	await updP;

	console.log('# 5. Bob also pings → distance should now be computed');
	await postJson('bob', '/api/location/ping', seed.bob.cookie, {
		lat: 22.32,
		lon: 114.17,
		accuracyM: 10,
		batteryPct: 55,
		charging: true,
		capturedAt: new Date().toISOString()
	});
	// Re-ping alice (50m+ away) to force a new broadcast carrying real distance.
	await new Promise((r) => setTimeout(r, 500));
	const updP2 = bobConn.inbox.wait<{ p: { distanceM: number | null } }>(
		(e) =>
			e.t === 'location_update' &&
			(e as { p: { distanceM: number | null } }).p.distanceM !== null
	);
	await postJson('alice', '/api/location/ping', seed.alice.cookie, {
		lat: 22.3225, // ~350m north
		lon: 114.1694,
		accuracyM: 10,
		batteryPct: 87,
		charging: false,
		capturedAt: new Date(Date.now() + 1).toISOString()
	});
	const u2 = (await updP2) as { p: { distanceM: number | null; bucket: string } };
	if (u2.p.distanceM === null) throw new Error('expected non-null distance');
	console.log(`  ✓ distance=${u2.p.distanceM}m bucket=${u2.p.bucket}`);

	console.log('# 6. Alice toggles ghost mode → bob expects ghost_change');
	const ghostP = bobConn.inbox.wait((e) => e.t === 'ghost_change');
	await postJson('alice', '/api/location/ghost', seed.alice.cookie, { enabled: true });
	await ghostP;

	console.log('# 7. Alice sends heartbeat_tap → bob expects heartbeat_tap');
	const tapP = bobConn.inbox.wait((e) => e.t === 'heartbeat_tap');
	aliceConn.ws.send(JSON.stringify({ t: 'heartbeat_tap', ts: Date.now() }));
	await tapP;

	console.log('# 8. Alice sets presence=away → bob expects presence(away)');
	const awayP = bobConn.inbox.wait<{ p: { presence: string } }>(
		(e) =>
			e.t === 'presence' &&
			(e as { p: { userId: string; presence: string } }).p.userId === seed.alice.userId &&
			(e as { p: { presence: string } }).p.presence === 'away'
	);
	aliceConn.ws.send(JSON.stringify({ t: 'presence', ts: Date.now(), p: { presence: 'away' } }));
	await awayP;

	console.log('# 9. Cleanup — restore ghost off so DB stays clean');
	await postJson('alice', '/api/location/ghost', seed.alice.cookie, { enabled: false });

	console.log('\n✅ ALL REALTIME CHECKS PASSED');
	aliceConn.ws.close();
	bobConn.ws.close();
}

main().catch((e) => {
	console.error('\n❌', e);
	process.exit(1);
});
