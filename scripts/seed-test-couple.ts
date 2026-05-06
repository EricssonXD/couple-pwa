/**
 * Dev-only seed: creates two paired users (alice + bob) and prints their
 * Better-Auth session cookies + couple id so the realtime smoke-test runner
 * can talk to /ws/couple as both halves of a couple.
 *
 * Idempotent: re-running rotates sessions but reuses users + couple.
 *
 * Hits the running dev server (no $env imports) so it works as a plain
 * Bun script. Requires `bun run dev` already up at $ORIGIN.
 *
 * Usage:
 *   bun run scripts/seed-test-couple.ts > /tmp/duosync-test.json
 */

import postgres from 'postgres';

const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5174';
const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
	console.error('DATABASE_URL not set');
	process.exit(1);
}
const sql = postgres(DATABASE_URL);

interface SeedAccount {
	email: string;
	password: string;
	name: string;
	emoji: string;
}

const ACCOUNTS: SeedAccount[] = [
	{ email: 'alice@duosync.test', password: 'alice-test-pw-2025', name: 'Alice', emoji: '🌸' },
	{ email: 'bob@duosync.test', password: 'bob-test-pw-2025', name: 'Bob', emoji: '🌊' }
];

function joinCookies(setCookies: string[]): string {
	const pairs = setCookies.map((sc) => sc.split(';', 1)[0]).filter(Boolean);
	return pairs.join('; ');
}

function collectSetCookie(res: Response): string[] {
	// Bun's fetch supports getSetCookie(); fall back to splitting the raw header.
	type GetSet = { getSetCookie?: () => string[] };
	const h = res.headers as unknown as GetSet;
	if (typeof h.getSetCookie === 'function') return h.getSetCookie();
	const raw = res.headers.get('set-cookie');
	if (!raw) return [];
	return raw.split(/,(?=\s*[a-zA-Z0-9_-]+=)/);
}

async function ensureUser(a: SeedAccount): Promise<string> {
	const existing = (await sql`SELECT id FROM "user" WHERE email = ${a.email} LIMIT 1`) as Array<{
		id: string;
	}>;
	if (existing.length) return existing[0].id;

	const res = await fetch(`${ORIGIN}/api/auth/sign-up/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email: a.email, password: a.password, name: a.name })
	});
	if (!res.ok) {
		throw new Error(`sign-up/email failed for ${a.email}: ${res.status} ${await res.text()}`);
	}
	const rows = (await sql`SELECT id FROM "user" WHERE email = ${a.email} LIMIT 1`) as Array<{
		id: string;
	}>;
	if (!rows.length) throw new Error(`user ${a.email} missing after signup`);
	return rows[0].id;
}

async function ensureProfile(userId: string, name: string, emoji: string) {
	await sql`
		INSERT INTO profile (user_id, display_name, avatar_emoji, onboarded_at)
		VALUES (${userId}, ${name}, ${emoji}, NOW())
		ON CONFLICT (user_id) DO NOTHING
	`;
}

async function ensureCouple(a: string, b: string): Promise<string> {
	const existing = (await sql`
		SELECT id FROM couple
		WHERE status = 'active'
		  AND ((partner_a = ${a} AND partner_b = ${b}) OR (partner_a = ${b} AND partner_b = ${a}))
		LIMIT 1
	`) as Array<{ id: string }>;
	if (existing.length) return existing[0].id;
	const rows = (await sql`
		INSERT INTO couple (partner_a, partner_b, status)
		VALUES (${a}, ${b}, 'active')
		RETURNING id
	`) as Array<{ id: string }>;
	return rows[0].id;
}

async function signInAndGrabCookie(a: SeedAccount): Promise<string> {
	const res = await fetch(`${ORIGIN}/api/auth/sign-in/email`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ email: a.email, password: a.password })
	});
	if (!res.ok) {
		throw new Error(`sign-in/email failed for ${a.email}: ${res.status}`);
	}
	const cookies = collectSetCookie(res);
	if (!cookies.length) throw new Error('no Set-Cookie returned');
	return joinCookies(cookies);
}

async function main() {
	const ids = await Promise.all(ACCOUNTS.map(ensureUser));
	await Promise.all(ids.map((id, i) => ensureProfile(id, ACCOUNTS[i].name, ACCOUNTS[i].emoji)));
	const coupleId = await ensureCouple(ids[0], ids[1]);
	const cookies = await Promise.all(ACCOUNTS.map(signInAndGrabCookie));
	const out = {
		origin: ORIGIN,
		coupleId,
		alice: { userId: ids[0], cookie: cookies[0] },
		bob: { userId: ids[1], cookie: cookies[1] }
	};
	process.stdout.write(JSON.stringify(out, null, 2) + '\n');
	await sql.end();
}

main().catch(async (e) => {
	console.error(e);
	await sql.end().catch(() => {});
	process.exit(1);
});

