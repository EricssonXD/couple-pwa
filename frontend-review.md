# DuoSync — Frontend Review (CLOSED)

> **Status: closed.** The 2026-05-15 audit (P0–P3 + §14 IA review) has
> been actioned. Follow-ups live in `plan.md`. Re-run the walker if you
> want a fresh snapshot:
>
> ```bash
> node /tmp/duosync-review/walk.mjs
> ```
>
> The walker requires a logged-in `alice@duosync.test` storage state and
> a running dev server on `:5175`.

## What shipped from the audit

- **§7.2 BottomNav contract** — design guide rewritten to document the
  actual 5-tab layout (Pulse · Map · Today · Moments · You). No more
  4-vs-5 drift.
- **§14 IA overhaul** — `HubChips` primitive + `HubHeader` composer
  surface every secondary route from a hub page; `/daily` and
  `/moments` adopted them; the `/settings` junk-drawer was trimmed
  (anti-pattern §13 added to the design guide).
- **`/settings/offline-queue` rebuild** — now uses the design system
  primitives and `--color-error` rose token instead of raw `#dc2626`.
- **`--ds-color-*` ghost namespace removal** — `QueueBadge`,
  `UpdatePromptBanner`, and the offline-queue page reference real
  daisyUI `--color-*` tokens; CI guard added.
- **Touch-target + focus-visible fixes** on `BackButton` and the
  inline icon buttons surfaced by the audit.

## Anything that bites you should reopen

If a future Playwright walk or visual diff turns up new drift, file it
straight into `plan.md` under "Not done" rather than restoring the
old multi-hundred-line audit document — `git log` and the design-guide
anti-pattern table (`docs/ui-design.md` §13) are now the canonical
reference for what's banned and what fixed it.
