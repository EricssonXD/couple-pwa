# DuoSync — 雙心同步

> A private PWA for two. **Passive presence**, not "where are you?". Live distance, mood, geo-moments, and milestones — all encrypted at the database, scoped per couple by Postgres Row-Level Security, and delivered to a home-screen-installed PWA on iOS and Android.

Live: <https://cozy.ericssoncodes.com>

---

## What it does today

| Surface            | What the user sees                                                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/welcome`         | Marketing hero + install CTA. Anonymous-only — signed-in users redirect pre-paint via `static/route-stub.js`.                                                    |
| `/auth/sign-in`    | Email + password (Google OAuth deferred). Cached offline so a captive-portal cold-launch still gets a useful screen.                                             |
| `/onboarding/link` | First-run flow + 6-char couple-link code.                                                                                                                        |
| `/pulse`           | Anniversary ribbon (taps through to /timeline) → connection streak → live distance bubble → partner avatar (presence + battery) → mood weather → heartbeat zone. |
| `/map`             | Shared Leaflet map with two pulsing pins + distance curve + Home/Work pins. Per-route dark theme.                                                                |
| `/moments`         | Vertical timeline of geo-moments. Cards stay locked + blurred until the partner is within radius.                                                                |
| `/moments/new`     | Composer with mini-map + draggable pin + radius slider + optional photo + expiry.                                                                                |
| `/daily`           | Daily question prompt — both partners answer privately, both reveal once both submit.                                                                            |
| `/timeline`        | Full milestone history (100d, 1y, 2y…) + countdowns to upcoming ones.                                                                                            |
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
4. **Pre-paint routing.** `static/route-stub.js` runs synchronously in `<head>` and `location.replace()`s signed-in users away from `/` and `/welcome` based on a client-readable `ds_auth` cookie (no secrets) — eliminates the welcome-flash regardless of cache state.
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
static/
  route-stub.js           # pre-paint redirect for / and /welcome
docs/                     # architecture + design notes
drizzle/                  # generated migrations + manual RLS SQL
e2e/                      # Playwright specs
messages/                 # Paraglide source locales
```

## Status

- **M0–M6**: backend + RLS + private realtime — done.
- **P-series**: PWA shell hardening — done.
- **U-series**: design-system rebuild + 8 routes — done.
- **A / H / N / R / G series** (post-MVP hardening, push, growth, reliability): all but `G3 photo-moments` (blocked on Storage bucket) shipped — see `plan.md` for the chronicle and `docs/next-phases.md` for the original spec.
- **Phase 2 (F-series)** features: F1 anniversary timeline, F2 daily prompts, F4 connection streak — shipped. Remaining tier-1+2 items tracked in `plan.md`.

## License

Private. © EricssonXD.
