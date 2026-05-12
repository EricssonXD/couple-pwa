# DuoSync — Roadmap

> Source of truth for what's left. Anything shipped lives in the
> README "Status" section or `git log` — `docs/history.md` is a
> frozen pivot-era plan, not a live chronicle.

---

## Routing & offline flow (current, do not regress)

The "logged-in user briefly sees /welcome" and "/auth bounce strands
offline" classes of bugs are guarded by three layers — see README
§"Routing & offline flow" for the canonical write-up.

```
                          GET /
                            │
               ┌────────────┴────────────┐
        (online: SSR)              (offline: SW serves cached / )
               │                              │
   hooks.server.ts populates              inline <script> in app.html
   locals.user / locals.couple            reads ds_auth cookie:
               │                          - 'pulse'      → /pulse
   /+page.server.ts:                      - 'onboarding' → /onboarding
   - no user      → /welcome              - none / unknown → stay /welcome
   - no couple    → /onboarding             (anonymous flow)
   - else         → /pulse                  no flash, runs in <head>
                            │
              + +layout.svelte beforeNavigate:
                cancel any /auth/* nav while offline+signed-in,
                reroute to /pulse (every /auth/* except sign-in
                is intentionally NOT precached).
```

The `ds_auth` cookie is set client-readable by `hooks.server.ts`
(NO secrets — purely a routing flag) and cleared the moment the
server stops seeing a user. SW precaches `/auth/sign-in` so a
captive-portal cold-launch still gets a usable form.

If you observe a regression: rebuild + redeploy, then clear the
PWA cache on the test device. The SW pinned to a stale `version`
hash will keep serving old HTML until the user gestures the
update banner.

---

## Done (do not re-plan)

- **MVP**: M0–M6 backend + RLS + private realtime.
- **PWA hardening**: P-series, R1–R4 (offline queue, idempotency,
  presence resilience, shell precache, conflict resolution).
- **Push (N-series)**: N1 VAPID, N2 trigger surface, N3 delivery
  worker, N4 iOS UX. Real VAPID keys provisioned. **Push-perf**: edge
  fn now sends `Urgency: high` + RFC 8030 `Topic` for OS-immediate
  wake + same-key coalescing; SvelteKit Worker fires
  `kickPushDeliver()` inline via `event.platform.context.waitUntil`
  so taps arrive in ~3-5s instead of waiting up to 60s for the next
  pg_cron tick. Cron stays as backstop. `verify_jwt=false` for
  `push-deliver` is pinned in `supabase/config.toml` because the fn
  authenticates with our own `Bearer CRON_TOKEN` — without that flag
  the platform 401s before our handler runs and the outbox piles up
  silently (user-visible symptom: "notifications only appear when I
  open the app").
- **Hardening (H-series)**: H1 sentry stub, H2 security headers,
  H3 rate limits, H4 account deletion, H5 anti-coercion + audit log.
- **Growth (G-series)**: G1 couple-link UX, G2 first-run, G4 unified
  settings. **G3 photo-moments — BLOCKED** on Supabase Storage bucket.
- **Phase 2 features**: F1 anniversary timeline, F2 daily prompts,
  F3 time-capsule (cron + UI), F4 connection streak, F5 mood pulse,
  F5b mood-trend strip, F6 shared bucket list, F8 shared calendar
  (v1 CRUD + v2 RRULE recurrence + v2 reminder cron — 24 h + 1 h
  push via `calendar_reminders` + `app.deliver_due_calendar_reminders`
  pg_cron job), F9 quiz packs (catalog + runner + reveal), F10
  throwbacks, **F11 PWA widgets** (manifest shortcuts + Adaptive
  Cards templates + `/api/widgets/<tag>` data endpoints + SW
  widgetinstall/widgetresume handler; Windows 11 today, iOS native
  widget extension still a future lift), **F16 repair toolkit**
  (cooldown timer → reflection → joint commitment, push to partner,
  audit-log entries on every transition).
- **CI/DX**: size-limit perf budget, RLS contract tests, a11y fixes,
  bundle-audit lazy splits.
- **F7 couple-only chat** — text-only with hard 7-day TTL (RLS SELECT
  predicate + hourly pg_cron purge + read-time service filter). Body
  in private realtime channel; NEVER in push payload (lockscreen
  privacy mirrors F16). History fetched client-side after hydration
  so SW + HTML cache cannot leak past retention. Voice notes deferred
  to F7 v2 once G3 (Storage bucket) exists. Migrations 0020 + 0021
  must be applied via `bun run db:push` or the Supabase SQL editor.

---

## Not done — in priority order

### Phase 2 — Tier 1 / 2 remaining

- **F18 premium gating** — Stripe + entitlement check in
  `hooks.server.ts`. Most competitors charge $5–10/mo. Free = MVP +
  Tier 1; premium = chat history >30d, time capsules >X, photo
  storage >100MB, advanced widgets.

### Phase 2 — Tier 3 (re-prioritize after retention metrics)

- **F14 cycle sharing** — sensitive; needs explicit opt-in toggle +
  audit log entry + clear delete path. Most useful for couples where
  one or both partners menstruate; not just data-sharing — surface
  fertility/symptom prediction tactfully.

### Parked

- F12 therapy modules (content-heavy; partner with therapist for IP)
- F13 shared playlist (per-provider OAuth cost)
- F15 voice/video calling (WebRTC + TURN cost; users have WhatsApp)
- F17 sticker packs / couple avatars (premium-tier polish)
- F19 smart notification budget (≤3 push/day priority ranking)
- F20 onboarding personality (3-question intake)

---

## Workflow per task

1. SQL todo → `in_progress`.
2. Implement.
3. Gates: `bun run check && bun run lint && bun run test:unit -- --run`
   (e2e only when the feature touches navigation/SW).
4. Commit with conventional message + `Co-authored-by: Copilot`.
   Frequent meaningful commits — never batch unrelated changes.
5. SQL todo → `done`.
6. ask_user for next.

---

## Notes

- DEFER G3 photo-moments until Storage bucket exists (outside our
  control to provision). F7 v2 voice notes also blocked on G3.
- N1–N3 ship code; real VAPID keys + Stripe (F18) + Storage (G3)
  all need ops setup before they actually do anything in prod.
- Update this plan only at major milestones. Per-task tracking
  lives in the SQL `todos` table.
