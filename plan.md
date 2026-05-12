# DuoSync — Roadmap

> Source of truth for what's left. Anything shipped lives in
> `docs/history.md` (chronicle) or the README status section.

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
   hooks.server.ts populates              static/route-stub.js
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
  worker, N4 iOS UX. Real VAPID keys still need an ops setup pass
  before anything actually fires in prod.
- **Hardening (H-series)**: H1 sentry stub, H2 security headers,
  H3 rate limits, H4 account deletion, H5 anti-coercion + audit log.
- **Growth (G-series)**: G1 couple-link UX, G2 first-run, G4 unified
  settings. **G3 photo-moments — BLOCKED** on Supabase Storage bucket.
- **Phase 2 features**: F1 anniversary timeline, F2 daily prompts,
  F3 time-capsule (cron + UI), F4 connection streak, F5 mood pulse,
  F5b mood-trend strip, F6 shared bucket list, F8 shared calendar
  v1 (CRUD), F10 throwbacks.
- **CI/DX**: size-limit perf budget, RLS contract tests, a11y fixes,
  bundle-audit lazy splits.

---

## Not done — in priority order

### Deploy (UNBLOCK ALL OTHER WORK)
- 8+ local commits sit ahead of `origin`. HTTPS prompt blocks
  `git push` from this env — needs `git push` from a credential-
  loaded shell, then `bash scripts/deploy.sh --skip-checks`.
- Until then, the welcome-flash fix, F3, F6, and F8 are not live.

### Phase 2 — Tier 1 / 2 remaining
- **F7 couple-only chat** — text + voice notes via existing Supabase
  channel. Voice notes blocked on G3 (Storage bucket).
- **F9 quiz packs** — "How well do you know me?" — static JSON in
  `/static/quizzes/*`, `quiz_runs` table, side-by-side reveal.
- **F18 premium gating** — Stripe + entitlement check in
  `hooks.server.ts`. Most competitors charge $5–10/mo. Free = MVP +
  Tier 1; premium = chat history >30d, time capsules >X, photo
  storage >100MB, advanced widgets.

### Phase 2 — Tier 3 (re-prioritize after retention metrics)
- F11 widgets (iOS PWA limited; Android web-app shortcuts first)
- F14 cycle sharing (sensitive — needs explicit opt-in toggle +
  audit log entry + clear delete path)
- F16 conflict-resolution / repair toolkit (therapeutic copy)

### Parked
- F12 therapy modules (content-heavy; partner with therapist for IP)
- F13 shared playlist (per-provider OAuth cost)
- F15 voice/video calling (WebRTC + TURN cost; users have WhatsApp)
- F17 sticker packs / couple avatars (premium-tier polish)
- F19 smart notification budget (≤3 push/day priority ranking)
- F20 onboarding personality (3-question intake)

### v2 of shipped features
- **F8 calendar v2**: rrule expansion (`rrule.js`), reminder cron
  (24h + 1h push). The `rrule TEXT NULLABLE` column is already in
  the schema — no migration needed.

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

- DEFER F7 voice notes + G3 photo-moments until Storage bucket
  exists (outside our control to provision).
- N1–N3 ship code; real VAPID keys + Stripe (F18) + Storage (G3)
  all need ops setup before they actually do anything in prod.
- Update this plan only at major milestones. Per-task tracking
  lives in the SQL `todos` table.
