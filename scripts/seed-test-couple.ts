/**
 * Dev-only seed: ensures two paired Supabase users (alice + bob) exist with
 * profiles and an active couple, and prints fresh access/refresh tokens so
 * `scripts/test-realtime.ts` can exercise the live realtime path.
 *
 * Idempotent: re-running reuses users + couple, but always rotates passwords
 * (so the seed-output password is the canonical one) and resets fixture
 * state (ghost off, location_ping wiped) so the smoke test is deterministic.
 *
 * No dev-server dependency. Talks directly to:
 *   - Supabase Auth Admin API (createUser / listUsers / updateUserById)
 *   - Postgres (Supavisor pooler) as the `postgres` superuser, which
 *     bypasses RLS — same trust boundary Drizzle uses in the app.
 *
 * Required env (loaded automatically from .env by Bun):
 *   PUBLIC_SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 *   PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *   DATABASE_URL                (Supavisor pooler, port 6543)
 *   ALLOW_TEST_SEED=1           (safety guard — refuses without it)
 *
 * Usage:
 *   ALLOW_TEST_SEED=1 bun run scripts/seed-test-couple.ts > /tmp/duosync-test.json
 */

import postgres from 'postgres';
import { createClient, type User } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_ANON_KEY = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const ORIGIN = process.env.ORIGIN ?? 'http://localhost:5173';

if (!process.env.ALLOW_TEST_SEED) {
	console.error('[seed] refusing to run without ALLOW_TEST_SEED=1 (safety guard).');
	console.error(`[seed] target Supabase URL: ${SUPABASE_URL ?? '<unset>'}`);
	process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !SUPABASE_ANON_KEY || !DATABASE_URL) {
	console.error(
		'[seed] missing required env. Need PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, ' +
			'PUBLIC_SUPABASE_PUBLISHABLE_KEY, DATABASE_URL.'
	);
	process.exit(1);
}

console.error(`[seed] target Supabase URL: ${SUPABASE_URL}`);
console.error('[seed] WARNING — this script mutates the live project. ALLOW_TEST_SEED set.');

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
	auth: { autoRefreshToken: false, persistSession: false }
});
// `prepare: false` is required for Supavisor transaction-mode pooling.
const sql = postgres(DATABASE_URL, { prepare: false });

interface SeedAccount {
	email: string;
	password: string;
	displayName: string;
	emoji: string;
}

const ACCOUNTS: SeedAccount[] = [
	{
		email: 'alice@duosync.test',
		password: 'alice-test-pw-2025!',
		displayName: 'Alice',
		emoji: '🌸'
	},
	{ email: 'bob@duosync.test', password: 'bob-test-pw-2025!', displayName: 'Bob', emoji: '🌊' }
];

async function findUserByEmail(email: string): Promise<User | null> {
	// Paginate until we find the user OR we get a short page (= last page).
	const perPage = 200;
	for (let page = 1; ; page++) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
		if (error) throw new Error(`listUsers failed: ${error.message}`);
		const hit = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
		if (hit) return hit;
		if (data.users.length < perPage) return null;
	}
}

async function ensureUser(a: SeedAccount): Promise<string> {
	const existing = await findUserByEmail(a.email);
	if (existing) {
		// Reset the password + force email-confirmed so signInWithPassword
		// always succeeds against this fixture, regardless of prior state.
		const { error } = await admin.auth.admin.updateUserById(existing.id, {
			password: a.password,
			email_confirm: true
		});
		if (error) throw new Error(`updateUserById(${a.email}) failed: ${error.message}`);
		return existing.id;
	}
	const { data, error } = await admin.auth.admin.createUser({
		email: a.email,
		password: a.password,
		email_confirm: true
	});
	if (error || !data.user) throw new Error(`createUser(${a.email}) failed: ${error?.message}`);
	return data.user.id;
}

async function ensureProfile(userId: string, a: SeedAccount): Promise<void> {
	await sql`
		INSERT INTO profile (user_id, display_name, avatar_emoji, onboarded_at)
		VALUES (${userId}, ${a.displayName}, ${a.emoji}, NOW())
		ON CONFLICT (user_id) DO UPDATE
		SET display_name = EXCLUDED.display_name,
		    avatar_emoji = EXCLUDED.avatar_emoji,
		    onboarded_at = COALESCE(profile.onboarded_at, EXCLUDED.onboarded_at)
	`;
}

async function ensureCouple(aId: string, bId: string): Promise<string> {
	// Schema CHECK enforces partner_a < partner_b (strict). UUID string
	// ordering is stable, so just sort lex.
	const [pa, pb] = [aId, bId].sort();

	// First: clear any stale OTHER active couple involving either fixture
	// user, since the schema's partial unique indexes only allow one active
	// couple per partner-side. We only nuke active couples that DON'T match
	// our pair — never a real-user pairing, since fixture users only ever
	// pair with each other.
	await sql`
		UPDATE couple
		SET status = 'broken', broken_at = NOW()
		WHERE status = 'active'
		  AND (partner_a = ${pa} OR partner_b = ${pa} OR partner_a = ${pb} OR partner_b = ${pb})
		  AND NOT (partner_a = ${pa} AND partner_b = ${pb})
	`;

	// Then: look up ANY couple for the pair (active OR otherwise) — the
	// (partner_a, partner_b) unique index is unconditional. Reactivate it.
	const existing = (await sql`
		SELECT id FROM couple WHERE partner_a = ${pa} AND partner_b = ${pb} LIMIT 1
	`) as Array<{ id: string }>;
	if (existing.length) {
		await sql`
			UPDATE couple SET status = 'active', broken_at = NULL WHERE id = ${existing[0].id}
		`;
		return existing[0].id;
	}
	const rows = (await sql`
		INSERT INTO couple (partner_a, partner_b, status)
		VALUES (${pa}, ${pb}, 'active')
		RETURNING id
	`) as Array<{ id: string }>;
	return rows[0].id;
}

async function resetFixtureState(coupleId: string, userIds: string[]): Promise<void> {
	// Wipe location history + ghost flags so test-realtime starts from a
	// known state. recordPing's movement / dedup gates would otherwise drop
	// re-runs silently.
	await sql`DELETE FROM location_ping WHERE couple_id = ${coupleId}`;
	await sql`DELETE FROM location_daily_summary WHERE couple_id = ${coupleId}`;
	await sql`
		UPDATE profile SET ghost_mode = FALSE, ghost_until = NULL
		WHERE user_id IN ${sql(userIds)}
	`;
}

async function signIn(a: SeedAccount): Promise<{ accessToken: string; refreshToken: string }> {
	const c = createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
	const { data, error } = await c.auth.signInWithPassword({ email: a.email, password: a.password });
	if (error || !data.session) throw new Error(`signIn(${a.email}) failed: ${error?.message}`);
	return { accessToken: data.session.access_token, refreshToken: data.session.refresh_token };
}

async function main() {
	const ids = await Promise.all(ACCOUNTS.map(ensureUser));
	await Promise.all(ids.map((id, i) => ensureProfile(id, ACCOUNTS[i])));
	const coupleId = await ensureCouple(ids[0], ids[1]);
	await resetFixtureState(coupleId, ids);
	const sessions = await Promise.all(ACCOUNTS.map(signIn));

	const out = {
		origin: ORIGIN,
		coupleId,
		alice: {
			userId: ids[0],
			email: ACCOUNTS[0].email,
			password: ACCOUNTS[0].password,
			...sessions[0]
		},
		bob: {
			userId: ids[1],
			email: ACCOUNTS[1].email,
			password: ACCOUNTS[1].password,
			...sessions[1]
		}
	};
	process.stdout.write(JSON.stringify(out, null, 2) + '\n');
	console.error(`[seed] ✓ couple ${coupleId} ready (alice=${ids[0]}, bob=${ids[1]})`);
	await sql.end();
}

main().catch(async (e) => {
	console.error('[seed] ✗', e);
	await sql.end().catch(() => {});
	process.exit(1);
});
