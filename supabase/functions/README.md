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

# 3. Deploy the function (config.toml below pins verify_jwt=false)
supabase functions deploy push-deliver --project-ref <ref>

# 4. Schedule (pg_cron example — see index.ts header)
```

### Custom Bearer auth (CRITICAL — read before redeploying)

`push-deliver` authenticates callers with its own
`Authorization: Bearer <CRON_TOKEN>` check (`index.ts` lines 92-95). The
Supabase platform's default JWT verifier MUST be off for that to work —
otherwise the gateway returns 401 before our function runs and **both
the pg_cron schedule and the inline kick from the SvelteKit Worker
silently stop firing pushes** (the user-visible symptom is "push
notifications only appear when I open the app", because the outbox
just piles up).

This is pinned in `supabase/config.toml`:

```toml
[functions.push-deliver]
verify_jwt = false
```

Re-deploying with the CLI default will pick that flag up. Avoid passing
`--verify-jwt` on the CLI, and never deploy push-deliver from a shell
that doesn't have this `config.toml` available.

### Low-latency tap delivery

pg_cron's minimum interval is 1 minute, which is too slow for tap-class
notifications. The SvelteKit Worker also fires the push-deliver function
inline (fire-and-forget via `ctx.waitUntil`) immediately after enqueueing
a row, so the typical latency drops from ~30s avg to ~3-5s. Cron stays
scheduled as a backstop for failed inline calls.

The edge function additionally sends `Urgency: high` + an RFC 8030
`Topic` header per (kind, recipient) so the OS wakes the SW immediately
on Android/iOS instead of batching for the next user-interaction wake.

To enable, set in Cloudflare Workers (NOT Supabase):

```sh
# Recommended — reads PUBLIC_SUPABASE_URL + CRON_TOKEN from .env
bash scripts/set-push-deliver-env.sh
```

Or manually:

```sh
PUSH_DELIVER_URL=https://<ref>.functions.supabase.co/push-deliver
CRON_TOKEN=<same value used for the cron schedule and Supabase secrets>
```

The Worker reads both via `$env/dynamic/private`. If either is missing,
`enqueue()` skips the kick silently and you fall back to cron-only
(higher latency but everything still works).

### Verifying in prod

Every kick logs one structured line — grep your Worker tail:

```sh
bun x wrangler tail --format pretty | grep "push-deliver kick"
# push-deliver kick status=200 ms=620
```

A status=401 means the CRON_TOKEN drift between Worker and Supabase. A
status=204 (or 200 with a body) is normal — the function returned
nothing-to-deliver or delivered some rows. ms is round-trip from the
Worker to the edge fn.

Local test:

```sh
supabase functions serve push-deliver --env-file .env.local
curl -H "Authorization: Bearer $CRON_TOKEN" \
     http://localhost:54321/functions/v1/push-deliver
```
