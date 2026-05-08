/**
 * Dev convenience seed: ensures two paired test users exist for local
 * development. Designed to be invoked from `scripts/dev-bootstrap.sh`
 * after the local Postgres + cloud Supabase project are reachable.
 *
 * Accounts (idempotent — safe to re-run):
 *   - test@test.com   / test1234  (Display: Test One,  emoji: 💗)
 *   - test2@test.com  / test1234  (Display: Test Two,  emoji: 🌿)
 *
 * They are paired as a single active couple. Re-running rotates both
 * passwords back to `test1234`, force-confirms emails, and resets ghost
 * state + clears stale link codes / location pings, so the dev DB is in
 * a known-good state every time.
 *
 * NOT FOR PRODUCTION. Refuses to run without ALLOW_DEV_SEED=1.
 *
 * Required env (loaded automatically from .env by Bun):
 *   PUBLIC_SUPABASE_URL
 *   SUPABASE_SECRET_KEY
 *   PUBLIC_SUPABASE_PUBLISHABLE_KEY
 *   DATABASE_URL                (local docker pg OR Supavisor pooler)
 *   ALLOW_DEV_SEED=1            (safety guard)
 *
 * Usage:
 *   ALLOW_DEV_SEED=1 bun run scripts/seed-dev-couple.ts
 */

import postgres from 'postgres';
import { createClient, type User } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;
const SUPABASE_ANON_KEY = process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!process.env.ALLOW_DEV_SEED) {
	console.error('[dev-seed] refusing to run without ALLOW_DEV_SEED=1 (safety guard).');
	console.error(`[dev-seed] target Supabase URL: ${SUPABASE_URL ?? '<unset>'}`);
	process.exit(1);
}
if (!SUPABASE_URL || !SUPABASE_SECRET_KEY || !SUPABASE_ANON_KEY || !DATABASE_URL) {
	console.error(
		'[dev-seed] missing required env. Need PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY, ' +
			'PUBLIC_SUPABASE_PUBLISHABLE_KEY, DATABASE_URL.'
	);
	process.exit(1);
}

console.error(`[dev-seed] target Supabase URL: ${SUPABASE_URL}`);
console.error(`[dev-seed] target Postgres   : ${DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`);

const admin = createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
	auth: { autoRefreshToken: false, persistSession: false }
});
// `prepare: false` is required when DATABASE_URL points at the Supavisor
// transaction-mode pooler. Harmless against direct local docker pg.
const sql = postgres(DATABASE_URL, { prepare: false });

interface SeedAccount {
	email: string;
	password: string;
	displayName: string;
	emoji: string;
}

const ACCOUNTS: [SeedAccount, SeedAccount] = [
	{ email: 'test@test.com', password: 'test1234', displayName: 'Test One', emoji: '💗' },
	{ email: 'test2@test.com', password: 'test1234', displayName: 'Test Two', emoji: '🌿' }
];

async function findUserByEmail(email: string): Promise<User | null> {
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
	// Schema CHECK enforces partner_a < partner_b (lex-sorted UUIDs).
	const [pa, pb] = [aId, bId].sort();

	// Demote any other active couple involving either fixture user.
	await sql`
		UPDATE couple
		SET status = 'broken', broken_at = NOW()
		WHERE status = 'active'
		  AND (partner_a = ${pa} OR partner_b = ${pa} OR partner_a = ${pb} OR partner_b = ${pb})
		  AND NOT (partner_a = ${pa} AND partner_b = ${pb})
	`;

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
	await sql`DELETE FROM location_ping WHERE couple_id = ${coupleId}`;
	await sql`DELETE FROM location_daily_summary WHERE couple_id = ${coupleId}`;
	await sql`
		UPDATE profile SET ghost_mode = FALSE, ghost_until = NULL
		WHERE user_id IN ${sql(userIds)}
	`;
	await sql`DELETE FROM link_code WHERE issuer_id IN ${sql(userIds)}`;
}

async function main() {
	const ids = await Promise.all(ACCOUNTS.map(ensureUser));
	await Promise.all(ids.map((id, i) => ensureProfile(id, ACCOUNTS[i])));
	const coupleId = await ensureCouple(ids[0], ids[1]);
	await resetFixtureState(coupleId, ids);

	console.error(`[dev-seed] ✓ couple ${coupleId} ready`);
	console.error('');
	console.error('  ┌────────────────────────────────────────────┐');
	console.error('  │  Dev test couple seeded                    │');
	console.error('  ├────────────────────────────────────────────┤');
	console.error(`  │  ${ACCOUNTS[0].email.padEnd(22)} / ${ACCOUNTS[0].password.padEnd(14)} │`);
	console.error(`  │  ${ACCOUNTS[1].email.padEnd(22)} / ${ACCOUNTS[1].password.padEnd(14)} │`);
	console.error('  └────────────────────────────────────────────┘');
	console.error('');
	await sql.end();
}

main().catch(async (e) => {
	console.error('[dev-seed] ✗', e);
	await sql.end().catch(() => {});
	process.exit(1);
});
