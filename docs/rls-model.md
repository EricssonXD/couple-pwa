# DuoSync — RLS & Realtime Trust Model

This doc describes the data-access boundary between the browser, the
SvelteKit edge (Cloudflare Workers), and Supabase Postgres + Realtime.

It is intended as the source of truth for **why** we have the policies in
`drizzle/manual/0002_rls_policies.sql` and `0003_realtime_rls.sql`, and
**how** to deploy a change to either layer without exposing data.

## Trust boundary, in one diagram

```
            ┌──────────────────────────────────────────────────────┐
            │  Browser (PWA)                                       │
            │  - supabase-js (anon JWT after sign-in)              │
            │  - subject to RLS                                    │
            └──────────────────────┬───────────────────────────────┘
                                   │ HTTPS (cookies) + WSS (JWT)
            ┌──────────────────────┴───────────────────────────────┐
            │  SvelteKit edge (Workers)                            │
            │  - Drizzle via postgres-js → role: postgres          │
            │      (BYPASSES RLS — privileged backend)             │
            │  - Supabase admin client → role: service_role        │
            │      (BYPASSES RLS — used for REST broadcast,        │
            │      pairing, etc.)                                  │
            │  Mutations validate locals.user / locals.couple      │
            │  before any DB write.                                │
            └──────────────────────┬───────────────────────────────┘
                                   │
            ┌──────────────────────┴───────────────────────────────┐
            │  Supabase Postgres + Realtime                        │
            │  RLS = default-deny. Three bypass paths:             │
            │    • service_role JWT    (admin client + REST)       │
            │    • postgres superuser  (Drizzle pooler)            │
            │    • SECURITY DEFINER helper functions               │
            │      (used inside policy `using` / `with check`)     │
            └──────────────────────────────────────────────────────┘
```

## Per-table policy summary (`public.*`)

| Table                    | SELECT                     | INSERT                                 | UPDATE                 | DELETE         |
| ------------------------ | -------------------------- | -------------------------------------- | ---------------------- | -------------- |
| `profile`                | self **or** active partner | self only                              | self only              | (none)         |
| `couple`                 | partner_a **or** partner_b | (none — admin)                         | partner_a or partner_b | (none — admin) |
| `link_code`              | issuer or consumer         | issuer only (`issuer_id = auth.uid()`) | (none — admin)         | (none)         |
| `location_ping`          | rows in caller's couple    | self ping in own couple                | (none — immutable log) | (none)         |
| `location_daily_summary` | rows in caller's couple    | (none — admin cron)                    | (none — admin)         | (none)         |

`app.current_couple_id()` is a STABLE SQL function (security INVOKER) that
resolves the caller's active couple via `auth.uid()`.

Pairing, unpair, link-code consumption, and daily summary maintenance run
through the **admin** Supabase client on the server — RLS does not apply
to them; the server validates inputs.

## Realtime model (`realtime.messages`)

Realtime topic format: `couple:<couple_uuid>`. Each connected pair has
exactly one private channel.

Server-only events (`location_update`, `ghost_change`, `heartbeat_tap`)
are fanned out via `POST /realtime/v1/api/broadcast` with the
service_role key and `private: true` — service_role bypasses RLS, so the
server is unaffected by the policies below.

Client-side, the policies apply:

| Action on `realtime.messages`                   | Policy                                                     | Caller                                                       |
| ----------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| SELECT, `extension in ('broadcast','presence')` | allowed if caller is a couple member of `realtime.topic()` | partner only                                                 |
| INSERT, `extension = 'presence'`                | allowed if caller is a couple member of `realtime.topic()` | partner only                                                 |
| INSERT, `extension = 'broadcast'`               | **no policy → denied**                                     | nobody (server uses service_role + REST, which bypasses RLS) |
| anything else                                   | **no policy → denied**                                     | —                                                            |

Membership check is implemented by `app.is_couple_topic_member()`, a
SECURITY DEFINER helper that compares `realtime.topic()` against
`'couple:' || c.id::text` using **text equality**. We deliberately do
_not_ parse the topic with `split_part(...)::uuid` — the planner is free
to reorder a `LIKE 'couple:%'` guard, which would let a malformed topic
trigger a UUID cast error and make all subscribes flap.

### Why no client INSERT for `extension = 'broadcast'`?

Without that restriction, a member of a couple could call
`channel.send({ type: 'broadcast', event: 'location_update', payload:
{ userId: <partner-uid>, lat: ..., lon: ... } })` and forge their
partner's location to themselves and any other listener. The fix:

- All trusted server events go through `POST /api/realtime/tap` (the
  generic server endpoint pattern), or are emitted directly by services
  (`location/ghost/ping`) using `broadcastToCouple()`.
- The browser only triggers the server endpoint; it does not write to
  the realtime topic at all. The client `RealtimeClient` exposes
  `sendHeartbeatTap()` which `fetch`es the server endpoint.

Presence INSERT is allowed because (a) presence payloads are scoped to
the writer's own `presence_ref`, and (b) the only field a partner could
forge is their own claimed status, which they could already do by the
design of the feature.

## Token refresh & long-lived tabs

Supabase Realtime evaluates authorization **at channel join and on
`setAuth()` only**. After the access token rotates, the WebSocket keeps
working but new policy evaluations would use the stale claims.

The client therefore subscribes to `auth.onAuthStateChange` and re-calls
`realtime.setAuth(session.access_token)` on `TOKEN_REFRESHED` and
`SIGNED_IN`. On `SIGNED_OUT` we tear the channel down.

## Unpair caveat

Authorization is evaluated at join + on `setAuth`. After two partners
unpair, an already-connected ex-partner continues to receive broadcasts
on the (now-orphaned) topic until they reconnect or their token rotates.
Mitigations:

- The server-side `broadcastToCouple()` call is reached from a code
  path that has already loaded `locals.couple`, so events stop being
  sent the moment the couple row is deleted/marked broken.
- Future work: force a client reconnect on unpair (e.g., bump a
  `couple.epoch` column and gate channel name on it).

## Deploy ordering

The realtime RLS migration and the client/server `private: true` flip
are tightly coupled:

1. **Apply `0003_realtime_rls.sql` first.** It's safe with the old
   client (which uses `private: false`); the policies only constrain
   `private: true` channels.
2. **Deploy server (`feat(realtime): tap endpoint + private:true REST broadcast`)
   and client (`feat(realtime)!: private channels …`) together.** Either
   one alone produces a half-broken state — the server would broadcast
   to private topics nobody is subscribed to, or the client would
   subscribe to private topics the server isn't broadcasting on.

## Smoke tests

- `bun run scripts/seed-test-couple.ts /tmp/duosync-test.json` — seeds
  alice, bob, charlie, the couple, a daily summary row, and clears
  stale link codes.
- `bun --env-file=.env scripts/test-rls.ts /tmp/duosync-test.json` —
  asserts SELECT visibility per table and per actor (anon / charlie /
  alice), distinguishes invisible-row UPDATE (0 rows, no error) from
  WITH CHECK violation INSERT (`code = '42501'`), and verifies that a
  non-member (`charlie`) is rejected with `CHANNEL_ERROR` when trying
  to subscribe to alice+bob's private channel.
- `bun run scripts/test-realtime.ts /tmp/duosync-test.json` — drives
  the API end-to-end through the dev server: presence, broadcast,
  ghost, heartbeat-tap-via-HTTP.
