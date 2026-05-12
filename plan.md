# DuoSync — Plan

> **Status doc + active backlog.** Historical chronicle of M0–M6 backend, P-series PWA shell, U-series UI rebuild, and the A/H/N/R/G post-MVP series lives in [`docs/history.md`](docs/history.md). This file only tracks what's true today and what's next.
>
> Live execution state is tracked in the session SQL `todos` table. Update plan.md only at milestones, not per task.

---

## What ships today

The product is the live PWA at <https://cozy.ericssoncodes.com>. See [`README.md`](README.md) for the per-route surface table and full stack summary. In one breath:

> SvelteKit 5 on Cloudflare Workers, Supabase (Auth + RLS + Realtime + Postgres + PostGIS), Drizzle on the server, Tailwind v4 + DaisyUI two-theme system, hand-written service worker with offline write queue, Web Push (VAPID), Paraglide i18n (en + zh-Hant). Eight user-facing routes, eighty-plus tests, all gates green.

## Routing & offline contract (post-`406e51b`)

This is the **canonical flow** — protect it. Tests in `e2e/sw-offline.test.ts` + `e2e/welcome-flash.spec.ts` guard the invariants.

```
                    Cold launch / icon tap
                              │
                              ▼
                ┌───────────────────────────┐
                │  static/route-stub.js     │  runs in <head>, before paint
                │  reads cookie `ds_auth`   │
                └────────────┬──────────────┘
                             │
        ┌────────────────────┼─────────────────────────┐
        ▼                    ▼                         ▼
   ds_auth=pulse       ds_auth=onboarding         (cookie absent)
   location.replace    location.replace           let SvelteKit render
       ↓                   ↓                          ↓
     /pulse            /onboarding/link             /welcome
```

- `ds_auth` is set by `handleSupabase` in `src/hooks.server.ts`. Values: `pulse` (linked couple), `onboarding` (signed-in but no partner), absent (anonymous). **Contains no secrets** — it's only a routing hint; real auth always re-validates server-side.
- Service worker (`src/service-worker.ts`):
  - `isPrivatePath()` blocks every `/auth/*` from cache **except** `/auth/sign-in` (carve-out).
  - `WARM_ROUTES` = `/`, `/welcome`, `/auth/sign-in` precached on activate.
  - Result: an offline cold-launch on a logged-out device still gets a working sign-in screen; an offline cold-launch on a signed-in device redirects pre-paint to `/pulse` and the service worker serves cached `/pulse` HTML + chunks.
- Service worker **never auto-reloads**. `skipWaiting` + `clients.claim` only fire on a user-gesture `SKIP_WAITING` message; UI banner reload waits on `controllerchange`.

## Done (phase summary)

| Phase               | Scope                                                                                                            | Notes                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| M0–M6               | Backend rewrite to Supabase + RLS + private Realtime                                                             | docs/history.md §0–10                 |
| P1–P9               | PWA shell hardening (SW, manifest, install, offline, update flow)                                                | docs/history.md §0–10                 |
| U1–U9               | Design-system rebuild (DaisyUI two-theme, motion, eight rebuilt routes, i18n parity)                             | docs/history.md §11                   |
| A1–A4               | i18n / a11y / test-flake / `ds_auth` cookie audits                                                               | shipped                               |
| H1–H5               | Sentry stub, security headers, rate limiting, account deletion, anti-coercion safeguards + audit log             | shipped                               |
| N1–N4               | VAPID plumbing, trigger surface, delivery worker, iOS standalone UX                                              | shipped (real VAPID keys = ops setup) |
| R1–R4               | Offline write queue + idempotency, presence resilience, shell precache, moment conflict resolution               | shipped                               |
| G1, G2, G4          | Couple-link UX, onboarding walkthrough, settings parity                                                          | shipped                               |
| F1, F2, F4, F5, F5b, F10 | Anniversary timeline (`/timeline`), daily prompts (`/daily`), connection streak, mood pulse + 14-day trend strip, on-this-day memory resurface | shipped                               |

**Blocked**: `G3 photo support in moments` — needs Supabase Storage bucket creation + CORS config (ops, not code).

## Active backlog — Phase 2 (F-series, post-MVP)

Researched against Couple/Between, Paired, Lasting, Love Nudge, Honi. DuoSync's wedge stays **passive presence + privacy**; these features extend the surface without diluting that.

### Tier 1 — High emotional ROI, low infra cost

- ✅ **F1 Anniversary timeline** — `couple_start_date` in `user_couples`; `/timeline` lists past + upcoming milestones; ribbon on `/pulse` taps through.
- ✅ **F2 Daily prompts** — JSON-bundled question pack, both partners answer, both reveal once both submit. Push reminder pending real VAPID config.
- ⏳ **F3 Love-note time capsule** — `scheduled_notes(id, couple_id, author, body, deliver_at, delivered_at)`; Cloudflare Workers Cron Trigger every 15 min. _First cron-worker pattern._
- ✅ **F4 Streaks + badges** — derived "connection streak" from any heartbeat OR moment OR prompt-answer per day; 1-day grace; shown on `/pulse` + `/settings`.
- ✅ **F5 Mood pulse** — 5-emoji picker on `/pulse` (`MoodPicker`); partner's latest mood renders as a badge under their avatar; live updates via realtime `mood_change` event. RLS keeps mood history private to the owner — only the latest per partner is fetched server-side for display. Picker disables when offline.
- ✅ **F5b Mood trend on /settings** — last-14-days emoji strip rendered by `MoodTrendStrip` in the `pulse_you()` section of `/settings`. SSR via `getMoodTrend(user.id, 14)`; days with no recorded mood show a muted dot. (Lives on `/settings`, not the aspirational `/settings/profile`.)

### Tier 2 — Mid-effort, distinctive

- ⏳ **F6 Shared bucket list** — `bucket_items` CRUD route `/bucket`; mark-done emits an auto-pinned moment.
- ⏸ **F7 Couple chat** (text + voice) — depends on F8 calendar maturity + Storage bucket (G3).
- ⏳ **F8 Shared calendar** — RRULE recurring events, date nights, anniversaries, period tracker, travel; 24h + 1h push reminders.
- ⏳ **F9 Quiz packs** — "How well do you know me?"; static quizzes in `/static/quizzes/*`; `quiz_runs` table for results.
- ✅ **F10 Memory throwbacks** — `resurfaceMemory(coupleId)` finds a moment from the same MM-DD in any prior year (≥30 days ago, ±2-day window), with first-ping fallback. `MemoryResurface` card renders on `/pulse` via SSR.

### Tier 3 — Bigger lifts, parked

F11 widgets, F12 therapy modules, F13 shared playlists, F14 cycle sharing, F15 voice/video, F16 repair toolkit, F17 inside-jokes/stickers — re-prioritize after Tier 1+2 ship and retention metrics arrive.

### Cross-cutting

- ⏳ **F18 Premium tier** — Stripe + entitlement check in `hooks.server.ts`. Free = current MVP + Tier 1; Premium = chat history > 30 days, time capsules, photo storage > 100MB, advanced widgets.
- ⏳ **F19 Smart notification budget** — cap to ≤3 push/day per user with priority ranking.
- ⏳ **F20 Onboarding personality** — 3-question intake (love language / time zone / primary goal) that personalizes default toggles + first-week prompts.

## Suggested sequencing (next up)

1. **F3 time capsule** — first **Cloudflare Workers Cron** worker; sets up the cron pattern reused by F8 reminders.
3. **F6 bucket list** — first new full-CRUD route post-MVP; battle-test the pattern.
4. **F8 calendar** — biggest UI surface; do after CRUD primitives are proven.
5. **F9 quiz packs** — content-driven, low risk; ship in parallel with F8.
6. **F18 premium gating** — once there are 2+ "wow" features behind it.
7. **F7 / F11 / F14 / F16** — re-prioritize from Phase-2 cohort retention data.

## Workflow per task

1. Set SQL todo `in_progress`.
2. Implement.
3. `bun run check && bun run lint && bun run test:unit -- --run --project client --project server`.
4. Add e2e if behavior is user-visible.
5. Fix anything red. Never disable a test to make it pass.
6. Commit with conventional message + `Co-authored-by: Copilot`.
7. Set SQL todo `done`. Deploy via `bash scripts/deploy.sh`.

## Architecture rules to never break

1. **No secret in client bundle.** `supabase-js` rides anon key + RLS-scoped JWT.
2. **Drizzle is server-only** (`src/lib/server/**`). Validate `locals.user` + `locals.couple` before every write.
3. **Realtime is server-authoritative.** Clients can subscribe + presence-track; broadcasts go through server REST.
4. **Pre-paint redirects** for `/` and `/welcome` via `static/route-stub.js` reading the `ds_auth` cookie.
5. **`/auth/sign-in` is offline-cached**, all other `/auth/*` private + uncached.
6. **Service worker never auto-reloads.** User-gesture only.
7. **Generated files** — `src/lib/paraglide/**` and `src/lib/server/db/auth.schema.ts` are GENERATED. Edit source (`messages/*.json`, auth config) and regenerate.
8. **Treat `plan.md` and `docs/history.md` as the source of truth for "what was built and why".** Update plan.md at milestones, not per task.
