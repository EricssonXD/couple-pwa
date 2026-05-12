# DuoSync — current plan

## Where we are

- **Backend (M0–M6)**: Supabase Auth + Postgres + Realtime + RLS, all green.
- **PWA shell (P-series)**: hand-written SW, offline fallback, user-gated update flow, IndexedDB write queue.
- **Design system (U-series)**: 8 routes rebuilt on bits-ui + DaisyUI + Inter/Fraunces.
- **Hardening (A / H / N / R / G)**: shipped — except `G3 photo-moments` (waiting on Supabase Storage bucket).
- **Phase-2 features shipped**: F1 anniversary timeline, F2 daily prompts, F4 connection streak, F5 mood pulse, F5b mood-trend strip, F10 throwbacks.
- **Routing & offline flow**: see `README.md` § "Routing & offline flow" — three-layer guard (server load, pre-paint script, layout `beforeNavigate`). `route-stub.js` covers `/` + `/welcome` only; `/auth/sign-in` is handled by SSR + the offline `beforeNavigate` reroute (extending the stub there causes a 303-vs-stub redirect loop with stale cookies).

## Invariants (do not regress)

1. No secret in the client bundle. RLS-scoped reads via `supabase-js`, never the service role.
2. Drizzle is server-only (`src/lib/server/**`); validates `locals.user` + `locals.couple` before any write.
3. Realtime is private + server-authoritative; clients can subscribe / presence-track but cannot INSERT broadcast.
4. Pre-paint routing eliminates welcome-flash regardless of cache state — `static/route-stub.js` handles `/` and `/welcome`. (Adding `/auth/sign-in` to the stub would race the SSR's stale-cookie clear and create an infinite redirect loop; the existing `beforeNavigate` SPA reroute + SSR redirect cover that route instead.)
5. SW never auto-reloads; `skipWaiting()` + `clients.claim()` only fire on a user-gesture `SKIP_WAITING` message.
6. `/auth/sign-in` is the only `/auth/*` route the SW pre-caches. Every other `/auth/*` route is private + uncached.
7. Migration application path: hand-written SQL in `drizzle/manual/`, applied via `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f drizzle/manual/NNNN_*.sql`. `db:push` skips RLS; `db:migrate` has no journal — neither works for these files.

## Workflow per task

1. Set SQL todo `in_progress`.
2. Implement.
3. `bun run check && bun run lint && bun run test:unit -- --run && bun run test:e2e`.
4. Fix anything red.
5. Commit (conventional + `Co-authored-by: Copilot`). One logical change per commit.
6. Set SQL todo `done`.
7. Ask user via `ask_user` what's next.

## Up next (Phase-2 backlog, in suggested order)

| ID  | Title                       | Notes                                                                                                                   |
| --- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| F3  | Love-note time capsule      | First Workers Cron pattern. Sister cron worker (don't patch `_worker.js`). Design parked in session `files/f3-parked/`. |
| F6  | Shared bucket list          | First new full CRUD route post-MVP. Mark-done emits a moment auto-pinned to map.                                        |
| F8  | Shared calendar             | Date nights + recurring (RRULE). Push reminders 24h + 1h.                                                               |
| F9  | Quiz packs                  | Static quiz JSON in `/static/quizzes/*`. Independent of F8 — can ship in parallel.                                      |
| F18 | Premium tier                | Once 2+ "wow" features exist behind it (F3 + F8). Stripe + entitlement check in `hooks.server.ts`.                      |
| F7  | Couple-only chat            | Text + voice notes. Voice depends on `G3` (Storage bucket).                                                             |
| F11 | Widgets (Android first)     | iOS PWA widget support is limited; ship Android Web App Manifest shortcut first.                                        |
| F14 | Period + cycle sharing      | Sensitive — explicit opt-in, audit log entry, clear delete path.                                                        |
| F16 | Conflict-resolution toolkit | Therapeutic angle, careful copy.                                                                                        |
| G3  | Photo moments               | DEFERRED — Storage bucket creation is out-of-band. Re-enable when bucket exists.                                        |

## Parked Tier-3 (re-prioritize after Phase-2 cohort metrics)

F12 couples-therapy modules, F13 shared playlist, F15 voice/video calling, F17 sticker packs, F19 smart notification budget, F20 onboarding personality.

## Operational notes

- `scripts/deploy.sh --migrate` is broken (calls `bun run db:migrate` which has no journal). Use `psql` directly.
- Push to `origin` over HTTPS prompts for credentials in this environment — commits stay local until user runs `bash scripts/deploy.sh --skip-checks`.
- F3 SQL + service code is parked at `~/.copilot/session-state/8ece339b-c8f6-4b9f-874c-1fb21a628180/files/f3-parked/` — picked back up whenever F3 is the next task.
