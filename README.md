# DuoSync — 雙心同步

> A private PWA for two. **Passive presence**, not "where are you?". Live distance, mood, geo-moments, and milestones — all encrypted at the database, scoped per couple by Postgres Row-Level Security, and delivered to a home-screen-installed PWA on iOS and Android.

Live: <https://cozy.ericssoncodes.com>

---

## What it does today

| Surface            | What the user sees                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/welcome`         | Marketing hero + install CTA. Anonymous-only — signed-in users redirect pre-paint via the inline `<script>` in `src/app.html`.                                   |
| `/auth/sign-in`    | Email + password (Google OAuth deferred). Cached offline so a captive-portal cold-launch still gets a useful screen.                                             |
| `/onboarding/link` | First-run flow + 6-char couple-link code.                                                                                                                        |
| `/pulse`           | Anniversary ribbon (taps through to /timeline) → connection streak → live distance bubble → partner avatar (presence + battery) → mood weather → heartbeat zone. |
| `/map`             | Shared Leaflet map with two pulsing pins + distance curve + Home/Work pins. Per-route dark theme.                                                                |
| `/moments`         | Vertical timeline of geo-moments. Cards stay locked + blurred until the partner is within radius.                                                                |
| `/moments/new`     | Composer with mini-map + draggable pin + radius slider + optional photo + expiry.                                                                                |
| `/daily`           | Daily question prompt — both partners answer privately, both reveal once both submit.                                                                            |
| `/notes`           | Schedule a private love-note to surface on a future date (F3 time capsule). Background pg_cron drains due notes into the push outbox.                            |
| `/bucket`          | Shared bucket list — couple-collaborative wishes with checkbox-toggle done state (F6).                                                                           |
| `/calendar`        | Shared calendar v1 — couple-collaborative single-occurrence events grouped by date (F8). Recurrence + reminder cron deferred to v2.                              |
| `/timeline`        | Full milestone history (100d, 1y, 2y…) + countdowns to upcoming ones.                                                                                            |
| `/quiz`            | "How well do you know me?" quiz packs — both partners answer about each other, scores reveal once both finalize (F9).                                            |
| `/settings`        | Profile, ghost-mode + duration, notifications, language (en / zh-Hant), theme, couple nickname + anniversary, partner-view audit log, account deletion.          |

## Stack

- **SvelteKit 5** (runes) + **TypeScript** + **mdsvex**.
- **adapter-cloudflare** → Cloudflare Workers SSR with `nodejs_compat` + `nodejs_als` flags.
- **Supabase**: Auth (`@supabase/ssr`), Postgres + PostGIS, Realtime (broadcast + presence + private channels), Storage (planned).
- **Drizzle ORM** via `postgres-js` over Supavisor pooler. Drizzle bypasses RLS as the privileged backend; client-side `supabase-js` rides RLS for any direct reads.
- **Tailwind v4** + **DaisyUI** themes (`duosync-light`, `duosync-dark`) + **bits-ui** primitives + **phosphor-svelte** icons. Inter + Fraunces type ramp.
- **Paraglide** for i18n (`messages/en.json`, `messages/zh-hant.json`).
- **Web Push (VAPID)** for notifications (iOS 16.4+ standalone PWA only).
- **PWA shell**: hand-written service worker with stale-while-revalidate HTML, shell + image LRU caches, offline fallback, user-gated update flow (no surprise reloads).
- **IndexedDB-backed offline write queue** (`src/lib/client/offline-queue.svelte.ts`) for location pings + moments — survives subway/airport gaps with idempotency keys + dead-letter UI.

## Architecture invariants

These are the non-negotiables. Most have unit tests guarding them.

1. **No secret in the client bundle.** Sensitive reads use `supabase-js` with the anon key + an RLS-scoped JWT, never the service role.
2. **Drizzle is server-only** (`src/lib/server/**`). Mutations validate `locals.user` + `locals.couple` before any DB write.
3. **Realtime is private + server-authoritative.** Server REST broadcasts `location_update` / `ghost_change` on the couple topic; clients can subscribe + presence-track but cannot INSERT broadcast. `heartbeat_tap` goes through `POST /api/realtime/tap`. RLS on `realtime.messages` blocks outsiders at the WS edge.
4. **Pre-paint routing.** An inline `<script>` in `src/app.html` (CSP-hashed automatically by SvelteKit's `mode: 'hash'` CSP) runs synchronously in `<head>` and `location.replace()`s signed-in users away from `/` and `/welcome` based on a client-readable `ds_auth` cookie (no secrets) — eliminates the welcome-flash with zero fetch overhead, regardless of cache state.
5. **Service worker never auto-reloads.** `skipWaiting()` + `clients.claim()` only fire on a user-gesture `SKIP_WAITING` message; banner reload is gated on `controllerchange` to survive iOS/Android home-screen installs.
6. **/auth/sign-in is offline-cached**, every other `/auth/*` route is private + never cached.

See `docs/rls-model.md` for the full trust-boundary diagram.

## Local development

```bash
bun install
cp .env.example .env   # fill in PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, etc.
bun run db:push        # push Drizzle schema to local/dev Supabase
bun run dev            # http://localhost:5173
```

### Validation gates

```bash
bun run check                                                  # svelte-check + paraglide sync
bun run lint                                                   # prettier + eslint
bun run test:unit -- --run --project client --project server   # 80+ tests, ~70s
bun run test:e2e                                               # playwright (excludes prod-smoke)
bun run build                                                  # cloudflare worker bundle
bun run size                                                   # per-route + total bundle budgets
```

### Deploy

```bash
bash scripts/deploy.sh           # runs gates then wrangler deploy
bash scripts/deploy.sh --skip-checks   # fast path when gates already green
```

## Project layout

```
src/
  routes/                 # SvelteKit routes (one folder per page)
  lib/
    components/
      ui/                 # bits-ui primitive wrappers
      duosync/            # domain components (DistanceBubble, AnniversaryRibbon, …)
    client/               # browser-only utilities (geolocation, realtime, offline queue, …)
    server/
      auth.ts             # Supabase server client factory
      db/                 # Drizzle client + schema
      services/           # business logic (location, daily, connection, audit, …)
    paraglide/            # GENERATED — never hand-edit; run `bun run check` to regen
    pwa/                  # SW registration + update banner client glue
  service-worker.ts       # hand-written SW (do NOT replace with workbox)
  app.html                # contains inline pre-paint redirect script (CSP-hashed)
static/
  quizzes/                # F9 quiz packs (static JSON content)
docs/                     # architecture + design notes
drizzle/                  # generated migrations + manual RLS SQL
e2e/                      # Playwright specs
messages/                 # Paraglide source locales
```

## Routing & offline flow

Three layered guards keep the right page in front of the right user, even
when the device is offline and the SW is serving cached HTML:

1. **Server load (online path)** — every protected route's `+page.server.ts`
   `redirect(303, …)`s based on `locals.user` / `locals.couple`. `/` is a
   redirect-only stub and never renders a body.
2. **Pre-paint inline `<script>` (`src/app.html`)** — runs synchronously in
   `<head>` before the body parses, with **zero fetch** (no external file,
   no SW cache hit). Reads the client-readable `ds_auth` cookie (set by
   `hooks.server.ts`, holds NO secret — values: `pulse`, `onboarding`,
   or absent) and `location.replace()`s away from `/` and `/welcome` for
   signed-in users. CSP `mode: 'hash'` in `svelte.config.js` auto-hashes
   the script tag so it stays compatible with strict CSP. Deliberately
   scoped to those two routes: extending it to `/auth/sign-in` would
   race the SSR's stale-cookie clear (303 from `/pulse` to `/auth/sign-in`
   then immediate pre-paint back to `/pulse` = infinite loop).
3. **Layout `beforeNavigate` (`src/routes/+layout.svelte`)** — when
   offline + signed-in, cancels SPA navigations targeting `/auth/*` and
   reroutes to `/pulse`. Every other `/auth/*` route is intentionally
   not pre-cached (private surface), so this prevents the user from
   stranding themselves on a network-error page.

`/auth/sign-in` is the one `/auth/*` route the SW pre-caches (anonymous,
state-free form) so a captive-portal cold launch still gets a usable
screen. The combination of (a) the offline `beforeNavigate` SPA reroute,
(b) the SSR redirect on hard navigation when online, and (c) the SSR
clearing the stale `ds_auth` cookie covers every reachable signed-in
visitor without needing a fourth `onMount` guard on the page itself.

## Status

- **M0–M6**: backend + RLS + private realtime — done.
- **P-series**: PWA shell hardening — done.
- **U-series**: design-system rebuild + 8 routes — done.
- **A / H / N / R / G series** (post-MVP hardening, push, growth, reliability): all but `G3 photo-moments` (blocked on Storage bucket) shipped. Per-feature trail in `git log`; high-level rationale in `docs/history.md` (frozen pivot-era plan, not a live chronicle).
- **Phase 2 (F-series)**: F1 anniversary timeline, F2 daily prompts, F3 love-note time capsule (cron + UI), F4 connection streak, F5 mood pulse, F5b mood-trend strip, F6 shared bucket list, F8 shared calendar v1, F9 quiz packs, F10 throwbacks — shipped. Remaining tier-1+2 items tracked in `plan.md`.

## License

Private. © EricssonXD.
