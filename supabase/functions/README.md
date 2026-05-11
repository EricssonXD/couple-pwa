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

Local test:

```sh
supabase functions serve push-deliver --env-file .env.local
curl -H "Authorization: Bearer $CRON_TOKEN" \
     http://localhost:54321/functions/v1/push-deliver
```
