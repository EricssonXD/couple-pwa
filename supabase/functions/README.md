# Supabase Edge Functions

Edge functions live alongside the SvelteKit app but deploy independently
via the Supabase CLI. They are excluded from the SvelteKit TS check,
ESLint, and Prettier — they target the Deno runtime, not Node/Workers.

## push-deliver (N3)

Drains `push_outbox` and dispatches Web Push notifications. See the
header comment in `push-deliver/index.ts` for the full deploy +
schedule walkthrough.

Quick start:

```sh
# 1. Generate VAPID keys (one-off, then store as Supabase secrets)
bun run scripts/generate-vapid-keys.ts

# 2. Set required secrets
supabase secrets set \
  VAPID_PUBLIC_KEY=... \
  VAPID_PRIVATE_KEY=... \
  VAPID_SUBJECT=mailto:ops@duosync.app \
  CRON_TOKEN=$(openssl rand -hex 32)

# 3. Deploy the function
supabase functions deploy push-deliver --project-ref <ref>

# 4. Schedule (pg_cron example — see index.ts header)
```

### Low-latency tap delivery

pg_cron's minimum interval is 1 minute, which is too slow for tap-class
notifications. The SvelteKit Worker also fires the push-deliver function
inline (fire-and-forget via `ctx.waitUntil`) immediately after enqueueing
a row, so the typical latency drops from ~30s avg to ~3-5s. Cron stays
scheduled as a backstop for failed inline calls.

To enable, set in Cloudflare Workers (NOT Supabase):

```sh
# Worker env vars (wrangler.jsonc / dashboard / `wrangler secret put`)
PUSH_DELIVER_URL=https://<ref>.functions.supabase.co/push-deliver
CRON_TOKEN=<same value used for the cron schedule>
```

The Worker reads both via `$env/dynamic/private`. If either is missing,
`enqueue()` skips the kick silently and you fall back to cron-only
(higher latency but everything still works).

Local test:

```sh
supabase functions serve push-deliver --env-file .env.local
curl -H "Authorization: Bearer $CRON_TOKEN" \
     http://localhost:54321/functions/v1/push-deliver
```
