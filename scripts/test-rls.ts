/**
 * RLS smoke test — DuoSync.
 *
 * Verifies that public.* tables and realtime.messages enforce the policies
 * defined in drizzle/manual/0002_rls_policies.sql + 0003_realtime_rls.sql.
 *
 * Three actors:
 *  - `anon`    : no auth (anon key only)
 *  - `charlie` : authenticated, lone (profile row but no couple)
 *  - `alice`   : authenticated, partnered with bob
 *
 * For each table we assert SELECT row counts and one negative write per class:
 *  - invisible-row UPDATE → returns 0 affected rows, no error
 *  - WITH CHECK violation INSERT → explicit error code 42501
 *
 * For realtime we assert that charlie cannot subscribe to alice+bob's
 * private channel (CHANNEL_ERROR / TIMED_OUT).
 *
 * Pre-req: `bun run scripts/seed-test-couple.ts /tmp/duosync-test.json`.
 *
 * Usage:
 *   bun run scripts/test-rls.ts /tmp/duosync-test.json
 */
import { readFileSync } from 'node:fs';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

interface Account {
	userId: string;
	email: string;
	password: string;
	accessToken: string;
	refreshToken: string;
}
interface SeedFile {
	coupleId: string;
	alice: Account;
	bob: Account;
	charlie: Account;
}

const seedPath = process.argv[2] ?? '/tmp/duosync-test.json';
const seed = JSON.parse(readFileSync(seedPath, 'utf8')) as SeedFile;

const supabaseUrl = process.env.PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey =
	process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.PUBLIC_SUPABASE_ANON_KEY ?? '';
if (!supabaseUrl || !supabaseAnonKey) {
	console.error('Missing PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_PUBLISHABLE_KEY in env (.env).');
	process.exit(1);
}

function clientFor(label: 'anon' | 'alice' | 'charlie'): SupabaseClient {
	const headers: Record<string, string> = {};
	if (label !== 'anon') {
		const tok = label === 'alice' ? seed.alice.accessToken : seed.charlie.accessToken;
		headers.Authorization = `Bearer ${tok}`;
	}
	return createClient(supabaseUrl, supabaseAnonKey, {
		global: { headers },
		auth: { persistSession: false, autoRefreshToken: false }
	});
}

let failures = 0;
function assertEq<T>(label: string, got: T, want: T) {
	if (got === want) {
		console.log(`  ✓ ${label}: ${String(got)}`);
	} else {
		failures++;
		console.error(`  ✗ ${label}: got ${String(got)}, want ${String(want)}`);
	}
}
function assertCmp(label: string, got: number, op: '>=' | '==' | '>', want: number) {
	const ok =
		(op === '>=' && got >= want) || (op === '==' && got === want) || (op === '>' && got > want);
	if (ok) {
		console.log(`  ✓ ${label}: ${got} ${op} ${want}`);
	} else {
		failures++;
		console.error(`  ✗ ${label}: got ${got}, want ${op} ${want}`);
	}
}

async function selectCount(
	sb: SupabaseClient,
	table: string,
	filter?: (q: ReturnType<SupabaseClient['from']>) => unknown
): Promise<number | string> {
	let q = sb.from(table).select('*', { count: 'exact', head: true });
	if (filter) q = filter(q) as typeof q;
	const { count, error } = await q;
	if (error) return `error:${error.code ?? error.message}`;
	return count ?? 0;
}

async function main() {
	console.log('# RLS smoke test\n');
	const anon = clientFor('anon');
	const alice = clientFor('alice');
	const charlie = clientFor('charlie');

	// ─── SELECT positive controls ───────────────────────────────────────────
	console.log('## SELECT visibility');
	console.log('- profile');
	assertEq('  anon sees 0 profiles', await selectCount(anon, 'profile'), 0);
	assertEq('  charlie sees only own profile', await selectCount(charlie, 'profile'), 1);
	assertEq('  alice sees self + bob (2)', await selectCount(alice, 'profile'), 2);

	console.log('- couple');
	assertEq('  anon sees 0 couples', await selectCount(anon, 'couple'), 0);
	assertEq('  charlie sees 0 couples', await selectCount(charlie, 'couple'), 0);
	assertEq('  alice sees 1 couple', await selectCount(alice, 'couple'), 1);

	console.log('- link_code (cleared by seed)');
	assertEq('  anon sees 0 link_codes', await selectCount(anon, 'link_code'), 0);
	assertEq('  charlie sees 0 link_codes', await selectCount(charlie, 'link_code'), 0);
	assertEq('  alice sees 0 link_codes', await selectCount(alice, 'link_code'), 0);

	console.log('- location_ping');
	assertEq('  anon sees 0 pings', await selectCount(anon, 'location_ping'), 0);
	assertEq('  charlie sees 0 pings', await selectCount(charlie, 'location_ping'), 0);
	const alicePings = await selectCount(alice, 'location_ping');
	assertCmp(
		'  alice sees ≥0 pings (couple-scoped)',
		typeof alicePings === 'number' ? alicePings : -1,
		'>=',
		0
	);

	console.log('- location_daily_summary (seeded 1)');
	assertEq('  anon sees 0 summaries', await selectCount(anon, 'location_daily_summary'), 0);
	assertEq('  charlie sees 0 summaries', await selectCount(charlie, 'location_daily_summary'), 0);
	const aliceSummaries = await selectCount(alice, 'location_daily_summary');
	assertCmp(
		'  alice sees ≥1 summary',
		typeof aliceSummaries === 'number' ? aliceSummaries : -1,
		'>=',
		1
	);

	// ─── Negative writes: WITH CHECK violation (INSERT) ─────────────────────
	console.log('\n## Negative INSERTs (expect WITH CHECK violation, 42501)');

	console.log('- charlie inserts location_ping for alice → 42501');
	{
		const { error } = await charlie.from('location_ping').insert({
			user_id: seed.alice.userId,
			couple_id: seed.coupleId,
			lat: 22.3,
			lon: 114.17,
			accuracy_m: 10,
			captured_at: new Date().toISOString()
		});
		assertEq('  error.code', error?.code ?? null, '42501');
	}

	console.log('- anon inserts link_code → 42501');
	{
		const { error } = await anon.from('link_code').insert({
			code: 'AAAAAA',
			issuer_id: seed.charlie.userId,
			expires_at: new Date(Date.now() + 60_000).toISOString()
		});
		assertEq('  error.code', error?.code ?? null, '42501');
	}

	console.log('- charlie inserts profile for alice → 42501');
	{
		const { error } = await charlie
			.from('profile')
			.insert({ user_id: seed.alice.userId, display_name: 'pwn' });
		assertEq('  error.code', error?.code ?? null, '42501');
	}

	console.log('- charlie inserts couple → 42501 (no INSERT policy)');
	{
		const { error } = await charlie.from('couple').insert({
			partner_a: seed.charlie.userId,
			partner_b: seed.alice.userId
		});
		assertEq('  error.code', error?.code ?? null, '42501');
	}

	// ─── Negative writes: invisible-row UPDATE (returns 0 rows, no error) ───
	console.log('\n## Negative UPDATEs (invisible row → 0 affected rows)');

	console.log("- charlie tries to UPDATE alice's profile (invisible) → 0 rows");
	{
		const { data, error } = await charlie
			.from('profile')
			.update({ display_name: 'pwn' })
			.eq('user_id', seed.alice.userId)
			.select('user_id');
		assertEq('  error', error?.code ?? null, null);
		assertEq('  rows affected', (data ?? []).length, 0);
	}

	console.log('- anon tries to UPDATE the couple (invisible) → 0 rows');
	{
		const { data, error } = await anon
			.from('couple')
			.update({ nickname: 'pwn' })
			.eq('id', seed.coupleId)
			.select('id');
		assertEq('  error', error?.code ?? null, null);
		assertEq('  rows affected', (data ?? []).length, 0);
	}

	// (positive INSERT control omitted: location_ping requires a non-null
	// `geog` column populated server-side via ST_MakePoint; the existing
	// row counts above already prove writes via the privileged API path.)

	// ─── Realtime: charlie should NOT join alice+bob's private channel ──────
	console.log('\n## Realtime: charlie blocked from couple:<alice+bob>');
	{
		// realtime auth must be set explicitly; the global Authorization header
		// only covers HTTP. (We then race the subscribe against a 6s timeout.)
		await charlie.realtime.setAuth(seed.charlie.accessToken);
		const ch = charlie.channel(`couple:${seed.coupleId}`, { config: { private: true } });
		const status = await new Promise<string>((resolve) => {
			const timer = setTimeout(() => resolve('TIMED_OUT_OUTER'), 6000);
			ch.subscribe((s) => {
				clearTimeout(timer);
				resolve(s);
			});
		});
		await charlie.removeChannel(ch).catch(() => {});
		await charlie.realtime.disconnect();
		const ok = status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'TIMED_OUT_OUTER';
		if (ok) console.log(`  ✓ subscribe rejected (status=${status})`);
		else {
			failures++;
			console.error(`  ✗ subscribe NOT rejected (status=${status})`);
		}
	}

	console.log('');
	if (failures === 0) {
		console.log('✅ ALL RLS CHECKS PASSED');
		process.exit(0);
	} else {
		console.error(`❌ ${failures} failure(s)`);
		process.exit(1);
	}
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
