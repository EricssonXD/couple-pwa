# DuoSync — Roadmap

> Source of truth for what's left. Anything shipped lives in the
> README "Status" section or `git log` — `docs/history.md` is a
> frozen pivot-era plan, not a live chronicle.

---

## Routing & offline flow (canonical, do not regress)

The classic "logged-in user briefly sees /welcome" and "/auth bounce
strands offline users" bugs are guarded by **three layers**. Same
write-up lives in `README.md §"Routing & offline flow"`; this is the
short-form version for plan readers.

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

Key invariants:

- `/` is a **router stub** — `+page.server.ts` always 303s, `+page.svelte`
  renders nothing (offline fallback only).
- `/welcome` is the cacheable anonymous landing surface; its
  `+page.server.ts` 303s signed-in users to `/pulse` or `/onboarding`
  so the back button from inside the app can never resurface it.
- `/auth/sign-in`, `/welcome`, `/onboarding` are precached in
  `SHELL_CACHE` so cold-launch + offline + already-signed-in still
  works. Every other `/auth/*` is intentionally NOT cached.
- `ds_auth` cookie is client-readable, holds NO secret (just the
  routing-flag value), set + cleared by `hooks.server.ts` on every
  request. The pre-paint inline script in `src/app.html` is the
  **only** thing fast enough to beat the welcome paint on cold
  launch — CSP `mode: 'hash'` auto-hashes it.

If a regression appears: rebuild + redeploy + clear PWA cache on the
test device. The SW pinned to a stale `version` hash will keep
serving old HTML until the user gestures the update banner.

---

## Done (do not re-plan)

- **MVP**: M0–M6 backend + RLS + private realtime.
- **PWA shell + update flow**: P-series including the
  vite-plugin-pwa migration (`injectManifest` + workbox helpers,
  `UpdatePromptBanner` + `onNeedRefresh`). Canonical doc:
  `docs/pwa-update-flow.md`.
- **Reliability (R-series)**: R1–R4 — offline queue + idempotency,
  presence resilience, shell precache, conflict resolution.
- **Push (N-series)**: N1 VAPID, N2 trigger surface, N3 delivery
  worker, N4 iOS UX. Real VAPID keys provisioned. Edge fn sends
  `Urgency: high` + RFC 8030 `Topic`; SvelteKit Worker fires
  `kickPushDeliver()` inline via `event.platform.context.waitUntil`
  so taps arrive in ~3-5 s. `verify_jwt=false` for `push-deliver` is
  pinned in `supabase/config.toml` (we authenticate with our own
  `Bearer CRON_TOKEN`).
- **Hardening (H-series)**: H1 sentry stub, H2 security headers,
  H3 rate limits, H4 account deletion, H5 anti-coercion + audit log.
- **Growth (G-series)**: G1 couple-link UX, G2 first-run, G4 unified
  settings. **G3 photo-moments — BLOCKED** on Supabase Storage bucket.
- **Phase 2 features**: F1 anniversary timeline, F2 daily prompts,
  F3 time-capsule (cron + UI), F4 connection streak, F5 mood pulse,
  F5b mood-trend strip, F6 shared bucket list, F7 couple-only chat
  (text + 7-day TTL — voice notes deferred to F7 v2 once G3 ships),
  F8 shared calendar (v1 CRUD + v2 RRULE + v2 reminder cron), F9
  quiz packs (catalog + runner + reveal), F10 throwbacks, **F11 PWA
  widgets** (manifest shortcuts + Adaptive Cards + `/api/widgets/<tag>`
  - SW `widgetinstall`/`widgetresume`; Windows 11 today, iOS native
    widget extension still a future lift), **F16 repair toolkit**.
- **Navigation**: secondary routes (timeline, bucket, notes, calendar,
  chat, quiz, repair, settings sub-pages) ship a reusable `BackButton`
  above their existing header — uses `afterNavigate`-tracked `canPop`
  so iOS standalone PWAs (which lie about `history.length`) still get
  a working fallback `goto`. `BottomNav.isActive` lights the parent
  tab on secondary routes via a `SECONDARY_PARENT` map.
- **IA overhaul (§14 of the closed `frontend-review.md`)**: `HubChips`
  primitive + `HubHeader` composer route the secondary surfaces from
  the hub pages they belong to (`/daily`, `/moments`); BottomNav tabs
  3 + 5 relabelled to `Today` / `You`; `/settings` junk-drawer rows
  for sibling features removed (kept only the diagnostic surfaces:
  offline-queue, activity, pet-ledger). Stories live alongside the
  primitive (`HubChips.stories.svelte`).
- **CI/DX**: size-limit perf budget, RLS contract tests, a11y fixes,
  bundle-audit lazy splits.

---

## Not done — in priority order

### Phase 2 — Tier 1 / 2 remaining

- **F18 premium gating** — Stripe + entitlement check in
  `hooks.server.ts`. Most competitors charge $5–10/mo. Free = MVP +
  Tier 1; premium = chat history > 30 d, time capsules > X, photo
  storage > 100 MB, advanced widgets.

### Phase 2 — Tier 3 (re-prioritize after retention metrics)

- **F14 cycle sharing** — sensitive; needs explicit opt-in toggle +
  audit log entry + clear delete path. Most useful for couples where
  one or both partners menstruate; not just data-sharing — surface
  fertility/symptom prediction tactfully.

### Parked

- **G3 photo-moments** — blocked on Supabase Storage bucket
  provisioning (outside our control). Unblocks F7 v2 voice notes.
- F12 therapy modules (content-heavy; partner with therapist for IP)
- F13 shared playlist (per-provider OAuth cost)
- F15 voice/video calling (WebRTC + TURN cost; users have WhatsApp)
- F17 sticker packs / couple avatars (premium-tier polish)
- F19 smart notification budget (≤ 3 push/day priority ranking)
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
6. `ask_user` for next.

---

## Notes

- F18 (Stripe) needs ops setup before it actually does anything in prod.
- G3 (Storage bucket) blocks photo-moments and F7 v2 voice notes.
- Update this plan only at major milestones. Per-task tracking
  lives in the SQL `todos` table.
