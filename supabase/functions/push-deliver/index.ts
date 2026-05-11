// Supabase Edge Function — N3 Push Delivery Worker
//
// Drains rows from `push_outbox` and dispatches Web Push notifications via
// the `web-push` library, then marks them delivered. Deployed separately
// from the SvelteKit Worker because:
//   - web-push relies on Node crypto / VAPID JWT signing and does not run
//     well on the SvelteKit Cloudflare Worker cold-start budget.
//   - Push delivery is a background concern. Decoupling it lets us scale
//     it independently and retry without affecting user-facing latency.
//
// ── Deploy ──────────────────────────────────────────────────────────────
//   supabase functions deploy push-deliver --project-ref <ref>
//   supabase secrets set \
//     VAPID_PUBLIC_KEY=... \
//     VAPID_PRIVATE_KEY=... \
//     VAPID_SUBJECT=mailto:ops@duosync.app
//   # service-role key + db url are auto-injected by Supabase
//
// ── Schedule ────────────────────────────────────────────────────────────
//   Either:
//   (a) pg_cron in Supabase SQL editor:
//       select cron.schedule(
//         'push-deliver', '*/1 * * * *',
//         $$ select net.http_post(
//             url := 'https://<ref>.functions.supabase.co/push-deliver',
//             headers := jsonb_build_object(
//               'Authorization', 'Bearer ' || current_setting('app.settings.cron_token')
//             )
//           ) $$
//       );
//   (b) External scheduler (Cloudflare Cron Trigger, GitHub Actions, …)
//       hitting the function URL once per minute with the cron token.
//
// ── Auth ────────────────────────────────────────────────────────────────
// Function expects an `Authorization: Bearer <CRON_TOKEN>` header. Set
// CRON_TOKEN via `supabase secrets set CRON_TOKEN=...` and reference it
// from your scheduler. Anonymous calls are rejected.

// deno-lint-ignore-file no-explicit-any
import webpush from 'npm:web-push@3.6.7';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;

interface OutboxRow {
	id: string;
	recipient_id: string;
	kind: string;
	title: string;
	body: string;
	data_json: string | null;
	attempts: number;
}

interface SubscriptionRow {
	endpoint: string;
	p256dh: string;
	auth: string;
}

function configureVapid() {
	const subject = Deno.env.get('VAPID_SUBJECT');
	const pub = Deno.env.get('VAPID_PUBLIC_KEY');
	const priv = Deno.env.get('VAPID_PRIVATE_KEY');
	if (!subject || !pub || !priv) {
		throw new Error(
			'Missing VAPID_SUBJECT / VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY env. Run `supabase secrets set ...`.'
		);
	}
	webpush.setVapidDetails(subject, pub, priv);
}

Deno.serve(async (req) => {
	const cronToken = Deno.env.get('CRON_TOKEN');
	const auth = req.headers.get('authorization') ?? '';
	if (!cronToken || auth !== `Bearer ${cronToken}`) {
		return new Response('unauthorized', { status: 401 });
	}

	configureVapid();

	const url = Deno.env.get('SUPABASE_URL')!;
	const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
	const supabase = createClient(url, serviceKey, {
		auth: { persistSession: false }
	});

	const { data: pending, error: pendingErr } = await supabase
		.from('push_outbox')
		.select('id, recipient_id, kind, title, body, data_json, attempts')
		.is('delivered_at', null)
		.lt('attempts', MAX_ATTEMPTS)
		.order('created_at', { ascending: true })
		.limit(BATCH_SIZE);

	if (pendingErr) {
		return Response.json({ error: pendingErr.message }, { status: 500 });
	}
	if (!pending || pending.length === 0) {
		return Response.json({ delivered: 0, gone: 0, failed: 0 });
	}

	let delivered = 0;
	let gone = 0;
	let failed = 0;

	for (const row of pending as OutboxRow[]) {
		const { data: subs, error: subErr } = await supabase
			.from('push_subscription')
			.select('endpoint, p256dh, auth')
			.eq('user_id', row.recipient_id);

		if (subErr || !subs || subs.length === 0) {
			// No subscriptions — mark delivered to drain the row.
			await supabase
				.from('push_outbox')
				.update({ delivered_at: new Date().toISOString(), attempts: row.attempts + 1 })
				.eq('id', row.id);
			continue;
		}

		const payload = JSON.stringify({
			kind: row.kind,
			title: row.title,
			body: row.body,
			data: row.data_json ? JSON.parse(row.data_json) : undefined
		});

		let anyOk = false;
		let lastError: string | null = null;
		const deadEndpoints: string[] = [];

		for (const sub of subs as SubscriptionRow[]) {
			try {
				await webpush.sendNotification(
					{
						endpoint: sub.endpoint,
						keys: { p256dh: sub.p256dh, auth: sub.auth }
					},
					payload,
					{ TTL: 60 * 60 * 24 }
				);
				anyOk = true;
			} catch (err: any) {
				const code: number | undefined = err?.statusCode;
				if (code === 404 || code === 410) {
					deadEndpoints.push(sub.endpoint);
					gone++;
				} else {
					lastError = `${code ?? '?'}: ${err?.body ?? err?.message ?? 'unknown'}`;
				}
			}
		}

		if (deadEndpoints.length > 0) {
			await supabase.from('push_subscription').delete().in('endpoint', deadEndpoints);
		}

		if (anyOk) {
			await supabase
				.from('push_outbox')
				.update({
					delivered_at: new Date().toISOString(),
					attempts: row.attempts + 1
				})
				.eq('id', row.id);
			delivered++;
		} else {
			await supabase
				.from('push_outbox')
				.update({
					attempts: row.attempts + 1,
					last_error: lastError
				})
				.eq('id', row.id);
			failed++;
		}
	}

	return Response.json({ delivered, gone, failed });
});
