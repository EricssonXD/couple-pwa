# DuoSync — Next Phases (post-MVP hardening & growth)

> Sequel to `plan.md` (which covers M0–M6 backend, P-series PWA shell,
> U-series UI rebuild — all marked DONE). This document captures what
> a private couples PWA still needs **before going public**, ordered
> by leverage. Each phase is independently shippable.
>
> Naming continues from existing series:
>
> - **H-series** (Hardening): observability, security, privacy.
> - **N-series** (Notifications): push end-to-end.
> - **G-series** (Growth/Glue): UX completeness, onboarding, social.
> - **R-series** (Reliability): offline durability, sync, conflict.
> - **A-series** (Audit cleanup): the small leftover items already on the menu.

---

## Context (where we stand, 2025-XX)

Done in current sprint:

- Welcome-flash pre-paint redirect (`c703646`).
- SW offline contract end-to-end test (`10727e6`, `bb8fbbc`).
- Bundle audit — Leaflet & Supabase already lazy. No code change needed.
- Sign-out HTML/IMG cache purge for shared-device privacy (`f1090fa`).
- Lint/format flat across the repo.

**Still missing for production**: no error tracking, no real push delivery,
no rate-limit on write endpoints, no account deletion flow, no offline
write queue, no a11y baseline, partial i18n parity, no perf budget in CI.

---

## A-series — Small audits (leftover from current menu)

Cheap follow-ups already on the table. Bundle them into one PR each.

- **A1 audit-i18n** — `settings_title`, `moments_title`, plus any string
  introduced by the welcome-flash work that lacks a `zh-hant` entry.
  Acceptance: `bun run check` clean + manual locale-toggle smoke pass.
- **A2 audit-a11y (HeartbeatZone)** — wire `aria-live="polite"` on the
  pulse zone so screen readers hear the partner heartbeat without a
  reload. Acceptance: Storybook a11y addon shows zero violations on
  `HeartbeatZone.stories`.
- **A3 audit-test-flake** — `axe-core` and `StarIcon` re-imports cause
  intermittent unit-test slowness on CI. Add to `optimizeDeps.include`
  in `vite.config.ts`. Acceptance: 5 consecutive `bun run test:unit -- --run`
  passes with no warm-cache complaint.
- **A4 ds-home-cookie** — extend `ds_auth` cookie payload with
  `pulse|link|onboarding` so the offline guard at `/` can route deeper
  than just "signed-in → /pulse". Plays well with R3 below.

---

## H-series — Hardening (security, privacy, observability)

### H1 — Error tracking & structured logging

**Why**: Right now a Worker exception is a silent 500. We can't tell
whether sign-in is broken in production.

**Approach**:

- Pick one: **Sentry** (sveltekit + cloudflare-workers SDK) or
  **Cloudflare Workers Logs + Logflare** (free tier, less PII risk).
- Wire `handleError` in `hooks.server.ts` and `hooks.client.ts`.
- Scrub email, lat/lon, partner name before send. PII redaction is
  non-negotiable for a couples app.
- Add a `correlation_id` middleware (request-scoped UUID) and log it
  on every Realtime broadcast for tracing across the WS edge.

**Acceptance**: a forced `throw` in a load function produces an event
in the dashboard within 30 s, with no email/lat/lon in the payload.

### H2 — CSP, HSTS, and security headers

**Why**: We embed Leaflet tiles + Supabase Realtime WS + (eventually)
push payloads. A strict CSP + COOP/COEP would block half the supply-chain
attacks before they start.

**Approach**:

- Add a `handle` hook that sets:
  - `Content-Security-Policy` (nonce-based for inline Svelte hydration
    — SvelteKit emits the nonces if you opt in).
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains; preload`.
  - `Referrer-Policy: strict-origin-when-cross-origin`.
  - `Permissions-Policy: geolocation=(self), notifications=(self), camera=(), microphone=()`.
- Keep `unsafe-inline` off; add `connect-src` for Supabase, Leaflet tiles,
  push endpoint.

**Acceptance**: `securityheaders.com` grade ≥ A; Lighthouse "best
practices" ≥ 95.

### H3 — Rate limiting on write endpoints

**Why**: `/api/location/ping`, `/api/moments/new`, `/api/profile`
have no rate limit. A leaked anon-key + a script could DoS the couple's
own quota.

**Approach**:

- Use Cloudflare's native **Rate Limiting Rules** (free tier covers
  the basic cases) on path patterns.
- For per-user limits (1 ping / 60 s), enforce in the existing
  `LocationError('rate_limited')` server guard — already there, just
  needs a 429 not 500.

**Acceptance**: scripted 100-rps burst returns 429s, not 5xx; Sentry
shows zero exceptions during the burst.

### H4 — Account deletion (GDPR + intimacy exit)

**Why**: A couple breaks up. The user MUST be able to wipe their data
including: location pings, moments, daily summaries, push subscription.
Partner sees a graceful "uncoupled" state, not a crash.

**Approach**:

- New route `/settings/delete-account` with double-confirm + a 7-day
  soft-delete window (allows accidental-click recovery).
- Cron-style cleanup via Supabase Edge Function (or Cron Trigger on a
  Worker) for hard delete after the window.
- "Uncouple" path that breaks the `couple` row but keeps each profile
  alive (separate from full delete).

**Acceptance**: deleted user → all owned rows gone; partner UI
shows "Your partner left." copy; re-signup with same email starts
clean.

### H5 — Anti-stalker / partner-coercion safeguards

**Why**: Location-sharing apps are weaponised in abusive relationships.
This is a design-ethics requirement, not a feature.

**Approach**:

- **Pause sharing** toggle on `/pulse` (already partly designed) —
  partner sees "paused" not a stale ping.
- **Decoy/quick-exit** — long-press app icon style "panic" gesture
  that swaps the visible page to a generic clock app and blocks the
  next push for 1 h. (Needs UX research; document as proposal.)
- **Audit log** visible to the user: "your partner viewed your pulse
  at 14:03". Asymmetric trust signal.
- Inactivity-based auto-pause: no app open in 24 h → auto-pause
  sharing until reopened.

**Acceptance**: pause/resume round-trip works; audit log query
returns the last 30 partner views.

---

## N-series — Notifications end-to-end

The `plan.md` chose **Web Push (VAPID)** but no delivery code is
checked in. iOS Safari 16.4+ supports it for installed PWAs only;
plan around that.

### N1 — VAPID key plumbing

- Generate VAPID keypair, store private key as a Worker secret,
  publish public key via `/api/push/vapid-public-key`.
- Subscribe flow on `/settings`: explicit "enable notifications"
  CTA (never auto-prompt — tanks PWA install rate).
- Persist subscription to a `push_subscription` table, RLS-locked
  to the owning user.

### N2 — Trigger surface

Three meaningful triggers (matches "passive presence" design):

1. Partner arrives at saved place (Home/Work).
2. Partner leaves a geo-moment within reach.
3. Partner battery < 15 %.

NO new-message-spam triggers — chat is "whisper", not push-loud.

### N3 — Delivery worker

- Use `web-push` library inside an Edge Function (Supabase) or a
  separate small Worker — DO NOT call from the SvelteKit Worker
  (cold-start budget).
- Triggered by Supabase row-insert webhook on the relevant table.
- Failed-subscription pruning on 410 Gone.

### N4 — iOS-specific UX

- Detect installed-PWA + iOS, show enable-notifications card with
  "this requires Add-to-Home-Screen first" copy if not standalone.
- Document the 16.4 minimum in onboarding.

**Acceptance**: end-to-end test on a staging device for each of the
three triggers; both Android and iOS-PWA paths.

---

## R-series — Reliability (offline durability, sync, conflict)

### R1 — Offline write queue (location pings + moments)

**Why**: Today, an offline ping is dropped. A user who walks into a
subway loses 20 minutes of pulse continuity.

**Approach**:

- IndexedDB-backed queue (use `idb-keyval` or write a tiny wrapper —
  no Dexie, weight matters).
- Background Sync API where available; fall back to "next foreground"
  flush.
- Server tolerates out-of-order pings via the existing
  `MIN_PING_MOVEMENT_M` + timestamp dedupe.

### R2 — Realtime presence resilience

- Supabase Realtime drops the WS on tab-suspend (mobile background).
  Add reconnect-with-backoff + a "stale > 90 s" UI state in
  `HeartbeatZone`.
- Visibility-change handler: on `visible`, force a presence
  re-broadcast.

### R3 — Richer offline routing (extends A4)

- The home cookie carries `pulse|link|onboarding`. Offline guard
  at `/` honours all three so an offline-first-launch (e.g. plane)
  still lands on a useful page.
- `/onboarding` and `/auth/sign-in` should be in `SHELL_CACHE` (precache)
  so first-time users in a captive-portal state see something.

### R4 — Conflict resolution for moments

- Two devices simultaneously edit the same moment: server uses
  `updated_at` last-write-wins with a small "your edit was overwritten,
  view diff" toast on the loser. Today there's no UX for this case.

---

## G-series — Growth & Glue (onboarding, polish)

### G1 — Couple-link UX completeness

- QR code + 6-character code (already partially scaffolded under
  `src/routes/onboarding/link`).
- Add "scan with camera" path (BarcodeDetector API where supported,
  fall back to manual code).
- Expiry: link codes valid 30 min, single-use.

### G2 — First-run delight

- `/onboarding` walks through: name, partner-link, geolocation
  permission, notification permission. Each step is skippable but
  re-promotable from `/settings`.
- Empty states for `/pulse` and `/moments` before the partner is
  linked — currently shows a broken-looking shell.

### G3 — Photo support in moments (defer until H1+H4 land)

- Supabase Storage bucket `moments`, RLS by couple_id.
- Image compression in-browser (~2 MB → ~200 KB) before upload —
  saves Cloudflare egress.

### G4 — Settings parity

- All toggles from "pause sharing", "audit log on", "notifications",
  "language", "theme", "delete account" land in one
  `/settings` screen with consistent rows.

---

## CI / DX umbrella (cross-cutting)

- **Performance budget**: add `size-limit` or Lighthouse-CI check
  in GitHub Actions. Initial budget: 220 KB JS gz on root layout
  (matches today's measurement).
- **RLS contract tests**: a Vitest suite that signs in as Alice,
  attempts to read Bob's `location_ping`, asserts 0 rows. Catches
  the worst class of regressions.
- **Renovate/Dependabot**: weekly bumps with auto-merge for patch
  versions of dev deps.
- **Preview deployments**: wrangler preview env per PR, plumbed to
  a separate Supabase project (the existing prod project must NOT
  receive PR traffic).

---

## Suggested execution order

1. **A1–A3** — finish the audit menu (cheap, builds momentum).
2. **H1 (error tracking)** — without this, every later phase is
   guessing in the dark.
3. **H4 (account deletion)** — required before any public beta.
4. **R1 (offline queue)** — unique to "passive presence" value prop.
5. **N1–N3 (push)** — biggest user-felt feature gap.
6. **H2, H3** (security headers, rate limit) — pre-launch checklist.
7. **G-series** — last, once the bones are right.

H5 (anti-coercion) lives alongside H4 — they ship as one ethics-pass
release, not separately.
