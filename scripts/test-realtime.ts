/**
 * End-to-end realtime smoke test (Supabase channels edition).
 *
 * Reads /tmp/duosync-test.json (from seed-test-couple.ts) and:
 *   1. Signs both users into the running dev server's form action so we
 *      hold valid Supabase SSR session cookies for /api/* requests.
 *   2. Opens two Supabase Realtime channels (one per user) on
 *      `couple:<coupleId>`.
 *   3. Drives the broadcast surface end-to-end:
 *        - server → client : location_update, ghost_change (POST /api/...)
 *        - client → client : heartbeat_tap (channel.send)
 *        - presence        : track + sync between alice and bob
 *
 * Requires `bun run dev` running at $ORIGIN (default http://localhost:5173).
 *
 * Usage:
 *   bun run scripts/test-realtime.ts /tmp/duosync-test.json
 */

import { readFileSync } from 'node:fs';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
	console.error('Missing PUBLIC_SUPABASE_URL or PUBLIC_SUPABASE_PUBLISHABLE_KEY');
	process.exit(1);
}

interface Seed {
	origin: string;
	coupleId: string;
	alice: { userId: string; email: string; password: string; accessToken: string };
	bob: { userId: string; email: string; password: string; accessToken: string };
}

const path = process.argv[2] ?? '/tmp/duosync-test.json';
const seed = JSON.parse(readFileSync(path, 'utf8')) as Seed;
const TOPIC = `couple:${seed.coupleId}`;
const TIMEOUT_MS = Number(process.env.RT_TIMEOUT_MS ?? 10_000);

// ─── HTTP helpers ─────────────────────────────────────────────────────────

function joinCookies(setCookies: string[]): string {
	return setCookies
		.map((sc) => sc.split(';', 1)[0])
		.filter(Boolean)
		.join('; ');
}

function collectSetCookie(res: Response): string[] {
	type GetSet = { getSetCookie?: () => string[] };
	const h = res.headers as unknown as GetSet;
	if (typeof h.getSetCookie === 'function') return h.getSetCookie();
	const raw = res.headers.get('set-cookie');
	if (!raw) return [];
	return raw.split(/,(?=\s*[a-zA-Z0-9_-]+=)/);
}

/**
 * Drive the SvelteKit form action `/auth/sign-in?/login` to mint Supabase
 * SSR session cookies. We use `redirect: 'manual'` so we can read
 * Set-Cookie off the 303 (otherwise fetch follows the redirect to /pulse
 * and most runtimes drop intermediate cookies).
 */
async function loginAndGetCookies(email: string, password: string): Promise<string> {
	const fd = new FormData();
	fd.set('email', email);
	fd.set('password', password);
	const res = await fetch(`${seed.origin}/auth/sign-in?/login`, {
		method: 'POST',
		body: fd,
		redirect: 'manual',
		// SvelteKit form-action CSRF check requires same-origin Origin header.
		headers: { origin: seed.origin }
	});
	// Form actions return 303 on success.
	if (res.status !== 303 && res.status !== 200 && res.status !== 204) {
		throw new Error(`sign-in failed for ${email}: ${res.status} ${await res.text()}`);
	}
	const cookies = collectSetCookie(res);
	if (!cookies.length) throw new Error(`no Set-Cookie from sign-in for ${email}`);
	return joinCookies(cookies);
}

async function postJson(label: string, path: string, cookie: string, body: unknown) {
	const res = await fetch(seed.origin + path, {
		method: 'POST',
		headers: { 'content-type': 'application/json', cookie },
		body: JSON.stringify(body)
	});
	const text = await res.text();
	console.log(`  [${label} POST ${path}] → ${res.status} ${text.slice(0, 80)}`);
	if (!res.ok) throw new Error(`${path} failed: ${res.status} ${text}`);
	return JSON.parse(text);
}

// ─── Channel inbox ────────────────────────────────────────────────────────
// Single buffered handler per channel — register all listeners BEFORE
// `.subscribe()` so we never miss the initial presence sync.

interface Inbox {
	channel: RealtimeChannel;
	broadcasts: Array<{ event: string; payload: unknown }>;
	presenceSnapshots: Array<Record<string, Array<Record<string, unknown>>>>;
	waitBroadcast: (
		event: string,
		pred: (p: Record<string, unknown>) => boolean,
		ms?: number
	) => Promise<Record<string, unknown>>;
	waitPresence: (
		pred: (state: Record<string, Array<Record<string, unknown>>>) => boolean,
		ms?: number
	) => Promise<Record<string, Array<Record<string, unknown>>>>;
}

function makeInbox(label: string, sb: SupabaseClient, userId: string): Inbox {
	const broadcasts: Array<{ event: string; payload: unknown }> = [];
	const presenceSnapshots: Array<Record<string, Array<Record<string, unknown>>>> = [];

	type BroadcastWaiter = {
		event: string;
		pred: (p: Record<string, unknown>) => boolean;
		resolve: (v: Record<string, unknown>) => void;
		reject: (e: Error) => void;
		to: ReturnType<typeof setTimeout>;
	};
	type PresenceWaiter = {
		pred: (s: Record<string, Array<Record<string, unknown>>>) => boolean;
		resolve: (v: Record<string, Array<Record<string, unknown>>>) => void;
		reject: (e: Error) => void;
		to: ReturnType<typeof setTimeout>;
	};
	const bWaiters: BroadcastWaiter[] = [];
	const pWaiters: PresenceWaiter[] = [];

	const channel = sb.channel(TOPIC, {
		config: {
			broadcast: { self: false },
			presence: { key: userId }
		}
	});

	channel
		.on('broadcast', { event: '*' }, (msg) => {
			const event = String(msg.event ?? '');
			const payload = (msg.payload ?? {}) as Record<string, unknown>;
			broadcasts.push({ event, payload });
			console.log(`  [${label} ←broadcast] ${event} ${JSON.stringify(payload).slice(0, 120)}`);
			for (let i = bWaiters.length - 1; i >= 0; i--) {
				const w = bWaiters[i];
				if (w.event === event && w.pred(payload)) {
					clearTimeout(w.to);
					w.resolve(payload);
					bWaiters.splice(i, 1);
				}
			}
		})
		.on('presence', { event: 'sync' }, () => {
			const snap = channel.presenceState() as Record<string, Array<Record<string, unknown>>>;
			presenceSnapshots.push(snap);
			console.log(
				`  [${label} ←presence sync] keys=${Object.keys(snap).join(',') || '(empty)'}`
			);
			for (let i = pWaiters.length - 1; i >= 0; i--) {
				const w = pWaiters[i];
				if (w.pred(snap)) {
					clearTimeout(w.to);
					w.resolve(snap);
					pWaiters.splice(i, 1);
				}
			}
		});

	const inbox: Inbox = {
		channel,
		broadcasts,
		presenceSnapshots,
		waitBroadcast(event, pred, ms = TIMEOUT_MS) {
			const hit = broadcasts.find(
				(b) => b.event === event && pred(b.payload as Record<string, unknown>)
			);
			if (hit) return Promise.resolve(hit.payload as Record<string, unknown>);
			return new Promise((resolve, reject) => {
				const to = setTimeout(() => {
					const i = bWaiters.findIndex((w) => w.to === to);
					if (i !== -1) bWaiters.splice(i, 1);
					reject(
						new Error(
							`[${label}] timeout waiting for broadcast '${event}' after ${ms}ms ` +
								`(saw ${broadcasts.length} total)`
						)
					);
				}, ms);
				bWaiters.push({ event, pred, resolve, reject, to });
			});
		},
		waitPresence(pred, ms = TIMEOUT_MS) {
			// Check current state synchronously — sync may have already fired.
			const cur = channel.presenceState() as Record<string, Array<Record<string, unknown>>>;
			if (pred(cur)) return Promise.resolve(cur);
			return new Promise((resolve, reject) => {
				const to = setTimeout(() => {
					const i = pWaiters.findIndex((w) => w.to === to);
					if (i !== -1) pWaiters.splice(i, 1);
					reject(new Error(`[${label}] timeout waiting for presence after ${ms}ms`));
				}, ms);
				pWaiters.push({ pred, resolve, reject, to });
			});
		}
	};

	return inbox;
}

async function subscribeChannel(label: string, channel: RealtimeChannel): Promise<void> {
	await new Promise<void>((resolve, reject) => {
		const to = setTimeout(() => reject(new Error(`[${label}] channel subscribe timeout`)), 8000);
		channel.subscribe((status) => {
			if (status === 'SUBSCRIBED') {
				clearTimeout(to);
				console.log(`  [${label}] channel subscribed`);
				resolve();
			} else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
				clearTimeout(to);
				reject(new Error(`[${label}] channel ${status}`));
			}
		});
	});
}

// ─── Test scenario ────────────────────────────────────────────────────────

async function main() {
	console.log('# 1. Sign in both users via dev server (cookies for /api/*)');
	const [aliceCookie, bobCookie] = await Promise.all([
		loginAndGetCookies(seed.alice.email, seed.alice.password),
		loginAndGetCookies(seed.bob.email, seed.bob.password)
	]);

	console.log('# 2. Open Supabase clients + channels (one per user)');
	const aliceSb = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
		auth: { persistSession: false, autoRefreshToken: false },
		realtime: { params: { eventsPerSecond: 20 } }
	});
	const bobSb = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
		auth: { persistSession: false, autoRefreshToken: false },
		realtime: { params: { eventsPerSecond: 20 } }
	});
	// Authenticate the realtime sockets (no-op for public channels today;
	// future-proof for when M6 flips to private channels with RLS).
	await aliceSb.realtime.setAuth(seed.alice.accessToken);
	await bobSb.realtime.setAuth(seed.bob.accessToken);

	const aliceInbox = makeInbox('alice', aliceSb, seed.alice.userId);
	const bobInbox = makeInbox('bob', bobSb, seed.bob.userId);

	await Promise.all([
		subscribeChannel('alice', aliceInbox.channel),
		subscribeChannel('bob', bobInbox.channel)
	]);

	console.log('# 3. Alice tracks presence → bob sees alice in presence state');
	const presenceP = bobInbox.waitPresence((s) => Boolean(s[seed.alice.userId]?.length));
	await aliceInbox.channel.track({
		presence: 'online',
		online_at: new Date().toISOString()
	});
	await presenceP;

	console.log('# 4. Alice POST /api/location/ping → bob waits for location_update');
	const upd1P = bobInbox.waitBroadcast(
		'location_update',
		(p) => (p as { p: { userId: string } }).p?.userId === seed.alice.userId
	);
	const ping1 = await postJson('alice', '/api/location/ping', aliceCookie, {
		lat: 22.3193,
		lon: 114.1694,
		accuracyM: 10,
		batteryPct: 88,
		charging: false,
		capturedAt: new Date().toISOString()
	});
	if (!ping1.accepted) throw new Error('expected first ping to be accepted');
	await upd1P;

	console.log('# 5. Bob pings, then alice pings ~350m away → distanceM populated');
	await postJson('bob', '/api/location/ping', bobCookie, {
		lat: 22.32,
		lon: 114.17,
		accuracyM: 10,
		batteryPct: 55,
		charging: true,
		capturedAt: new Date().toISOString()
	});
	const upd2P = bobInbox.waitBroadcast(
		'location_update',
		(p) =>
			(p as { p: { userId: string; distanceM: number | null } }).p?.userId ===
				seed.alice.userId &&
			(p as { p: { distanceM: number | null } }).p.distanceM !== null
	);
	const ping2 = await postJson('alice', '/api/location/ping', aliceCookie, {
		lat: 22.3225,
		lon: 114.1694,
		accuracyM: 10,
		batteryPct: 87,
		charging: false,
		capturedAt: new Date(Date.now() + 1000).toISOString()
	});
	if (!ping2.accepted) throw new Error('expected ~350m re-ping to be accepted');
	const u2 = (await upd2P) as { p: { distanceM: number; bucket: string } };
	console.log(`  ✓ distance=${u2.p.distanceM}m bucket=${u2.p.bucket}`);

	console.log('# 6. Alice toggles ghost mode → bob waits for ghost_change');
	const ghostP = bobInbox.waitBroadcast(
		'ghost_change',
		(p) =>
			(p as { p: { userId: string; ghost: boolean } }).p?.userId === seed.alice.userId &&
			(p as { p: { ghost: boolean } }).p.ghost === true
	);
	await postJson('alice', '/api/location/ghost', aliceCookie, { enabled: true });
	await ghostP;

	console.log('# 7. Alice channel.send heartbeat_tap → bob waits for heartbeat_tap');
	const tapP = bobInbox.waitBroadcast(
		'heartbeat_tap',
		(p) => (p as { p: { userId: string } }).p?.userId === seed.alice.userId
	);
	await aliceInbox.channel.send({
		type: 'broadcast',
		event: 'heartbeat_tap',
		payload: { t: 'heartbeat_tap', ts: Date.now(), p: { userId: seed.alice.userId } }
	});
	await tapP;

	console.log("# 8. Alice updates presence → bob sees alice's meta as 'away'");
	const awayP = bobInbox.waitPresence((s) => {
		const metas = s[seed.alice.userId];
		return Array.isArray(metas) && metas.some((m) => m.presence === 'away');
	});
	await aliceInbox.channel.track({
		presence: 'away',
		online_at: new Date().toISOString()
	});
	await awayP;

	console.log('# 9. Cleanup — restore ghost off, untrack, removeChannel');
	await postJson('alice', '/api/location/ghost', aliceCookie, { enabled: false });
	await aliceInbox.channel.untrack().catch(() => {});
	await bobInbox.channel.untrack().catch(() => {});
	await aliceSb.removeChannel(aliceInbox.channel);
	await bobSb.removeChannel(bobInbox.channel);
	await aliceSb.realtime.disconnect();
	await bobSb.realtime.disconnect();

	console.log('\n✅ ALL REALTIME CHECKS PASSED');
}

main().catch((e) => {
	console.error('\n❌', e);
	process.exit(1);
});
