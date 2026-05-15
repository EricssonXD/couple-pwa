# DuoSync — Frontend Review

> Snapshot: 2026-05-15T07:20:51Z
> Method: read-only audit of `src/routes/`, `src/lib/components/`, `docs/ui-design.md`, and Playwright artefacts in `/tmp/duosync-review/` (19 authed routes + 3 anon × mobile/desktop). No source files were modified. Findings cite `file:line` and screenshot filenames.
>
> Regen evidence with: `node /tmp/duosync-review/walk.mjs` (Playwright walker that produced `screenshots/` and `findings.json`).
>
> This document is meant to be **consumed and pruned** — close findings as you fix them.

## Severity legend

- **P0** Blocks ship / breaks UX or accessibility for everyone (must fix).
- **P1** Visible drift from `docs/ui-design.md`, hits multiple routes (fix this sprint).
- **P2** Polish / inconsistency, single-route or cosmetic (fix when nearby).
- **P3** Nit, philosophical, or doc-vs-code reconciliation (note and move on).

---

## 1. Cross-cutting findings

### 1.1 [P1] BottomNav has 5 tabs — design guide §7.2 says 4

`src/lib/components/duosync/BottomNav.svelte:39-45` ships **Pulse / Map / Daily / Moments / Settings**. `docs/ui-design.md` §7.2 explicitly defines the BottomNav as **4 tabs (Daily deferred)** and the file's own header doc-block (lines 9-11) repeats that contract. Visible in every authed mobile screenshot — e.g. `mobile-11-pulse.png`, `mobile-30-settings.png`, `mobile-32-settings-offline-queue.png`.

Either drop `/daily` from the tab list (it's already reachable via `Daily` chip on `/pulse` and as a parent for `/chat`, `/quiz`, `/repair` per the `SECONDARY_PARENT` map at `BottomNav.svelte:55-63`) or amend the design guide §7.2. **Pick one.** The current state is contract drift that will keep generating audit findings.

Side-effect: at 5 tabs × 75px each on a 390 px viewport with `max-w-md` (448 px), labels stay readable but icons lose breathing room — see `mobile-11-pulse.png` bottom strip.

### 1.2 [P1] `--ds-color-*` token namespace is undefined — every fallback hex paints

The tokens defined in `src/routes/+layout.css` are `--color-*` (daisyUI-aligned: `--color-base-100`, `--color-primary`, `--color-error`, `--distance-*`, `--shadow-paper`, `--radius-*`). Three files reference a parallel `--ds-color-*` namespace that **never gets declared anywhere**, so the fallback hex literal is what actually renders:

| File                                                   | Line      | Fallback hex (the actual paint)                                         |
| ------------------------------------------------------ | --------- | ----------------------------------------------------------------------- |
| `src/lib/components/duosync/QueueBadge.svelte`         | 45-46, 52 | `#1f2937`, `#f9fafb`, `rgb(255 255 255 / 0.12)`                         |
| `src/lib/components/duosync/UpdatePromptBanner.svelte` | 61-99     | `#1f2937`, `#f9fafb`, `#6366f1`, `rgb(255 255 255 / 0.08)`              |
| `src/routes/settings/offline-queue/+page.svelte`       | 114-186   | `#6b7280`, `#f3f4f6`, `#dc2626`, `rgba(0,0,0,0.12)`, `rgba(0,0,0,0.08)` |

Hard-coded hex is anti-pattern §13. The `#dc2626` red on `/settings/offline-queue` clashes with `--color-error` (`oklch` rose) and is visible as a different shade in `mobile-32-settings-offline-queue.png` (the "Discard all" outline). Two fixes either work:

1. Define `--ds-color-*` aliases in `+layout.css` that point at the canonical `--color-*` tokens, OR
2. Migrate these three files to Tailwind utilities (`bg-base-200`, `text-base-content/60`, `border-error/30`) like the rest of the app.

(2) is correct — `/settings/offline-queue` is the only page in the app with a scoped `<style>` block, and it predates the design system. See §1.6.

### 1.3 [P1] `--color-error` is overused (anti-pattern §13 says "SOS only")

§13: _"`--color-error` is for the SOS button only. Form errors and warnings → `--color-warning`."_ Found in non-SOS contexts:

- `src/routes/moments/+page.svelte:157` — delete-moment hover `text-error`.
- `src/routes/notes/+page.svelte:111` — error toast `text-error`. `:142` — cancel-edit btn `text-error`.
- `src/routes/calendar/+page.svelte:190` — error toast. `:253` — remove-event btn.
- `src/routes/bucket/+page.svelte:119, 163, 202` — error toast + cancel + delete.
- `src/routes/settings/+page.svelte:303` (`text-error` for UNPAIR section title), `:392` (DELETE ACCOUNT title) — visible in `desktop-30-settings.png` as the rose-tinted pill cards at the bottom.

The settings danger sections are arguably "destructive identity action" and may genuinely need `error`; the toasts/cancel buttons should be `text-warning` or `text-base-content/60`. Either tighten the rule in §13 ("`error` for SOS + irreversible account actions only") or migrate the toasts.

### 1.4 [P1] `shadow-sm` / `shadow-md` used despite §13 banning everything except `shadow-paper`

| File                               | Line     | Class             |
| ---------------------------------- | -------- | ----------------- |
| `src/routes/notes/+page.svelte`    | 135, 162 | `shadow-sm`       |
| `src/routes/calendar/+page.svelte` | 214      | `shadow-sm`       |
| `src/routes/bucket/+page.svelte`   | 134, 186 | `shadow-sm`       |
| `src/routes/quiz/+page.svelte`     | 39       | `hover:shadow-md` |

Replace with `shadow-paper` (the only token defined in `+layout.css`). Trivial mechanical fix.

### 1.5 [P1] Raw daisyUI inputs duplicate `InputField` primitive

`InputField` (`src/lib/components/ui/InputField.svelte`) encodes the canonical input chain (radius token, hairline border, `focus:border-primary`). It's used in `onboarding`, `settings`, `repair`, `auth/sign-in`, `moments/new`. It's **bypassed** by:

- `src/routes/notes/+page.svelte` — bare `<textarea class="textarea-bordered textarea h-28">`.
- `src/routes/calendar/+page.svelte` — bare `<input class="input-bordered input">` for date.
- `src/routes/bucket/+page.svelte` — bare `<input class="input-bordered input">` for title.

These inherit daisyUI's default styling, which differs from `InputField` (different radius, no `focus:border-primary` consistency). Visible drift in `mobile-16-notes.png`, `mobile-17-calendar.png`, `mobile-18-bucket.png` — corners are sharper and focus is browser-blue. Replace with `<InputField>` / `<InputField rows={4}>`.

### 1.6 [P0] `/settings/offline-queue` was never rebuilt for the design system

Only page in the authed app that uses scoped `<style>` (lines 98-192) instead of Tailwind utilities. Uses raw `<button>` elements (no `PillButton`), undefined CSS vars (§1.2), `rgba(0,0,0,0.12)` literals, no `Card` / `SectionHeader` primitives. The retry button overlaps the giant "0" digit in `mobile-32-settings-offline-queue.png` (`Retry now` sits to the right of `pending` label and visually crashes).

This page is the cleanest single-file rewrite candidate in the app — port to `Card` + `SectionHeader` + `PillButton` and the §1.2 finding closes with it.

### 1.7 [P2] CSP dev-only nuisance — every page logs 1 inline-script violation

`findings.json` shows every URL returns 200 and every URL emits exactly one console error: `Refused to execute inline script because it violates the following Content Security Policy directive...`. The hash in the CSP header doesn't match the inline pre-paint script in `src/app.html` (the script body is content-dependent and evidently regenerated per render). This is a dev-server-only nuisance and does not affect Playwright's render success — but it pollutes the console for every developer and obscures real client-side errors.

Fix in a follow-up: either (a) emit the inline script's `sha256` from the build into the CSP at SSR time, (b) move the pre-paint to an external file with a `nonce`, or (c) suppress in dev only by relaxing `script-src` for `NODE_ENV=development`.

### 1.8 [P2] Touch-target drift on `BackButton` and a few inline icon buttons

Design guide §10.2: minimum 44×44 px hit area.

- `src/lib/components/duosync/BackButton.svelte:57` — `h-9 w-9` = 36 px circle. Fails.
- `src/routes/moments/+page.svelte:157` — delete button `h-7 w-7` = 28 px. Fails badly. (Also uses `text-error` per §1.3.)
- `notes/calendar/bucket` use daisyUI `btn-xs` for cancel/delete pills — daisyUI's xs is ~28 px tall. Fails.

`BottomNav` itself is fine (56 px minimum because of `py-2 + 22px icon + 11px label`). `PillButton` md/lg already enforce `min-h-11` / `min-h-12` (`PillButton.svelte:68-69`) ✓.

### 1.9 [P2] `BackButton` has no visible `focus-visible` ring

`src/lib/components/duosync/BackButton.svelte:57` — relies on the browser's default focus ring inside a `bg-base-100 border-base-content/10` chip, which is invisible against the cream background in screenshots. Add `focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none`. Same opportunity on the sign-in tab buttons (`src/routes/auth/sign-in/+page.svelte:34` area).

### 1.10 [P2] `confirm()` browser dialog used for destructive actions

`src/routes/notes/+page.svelte:61` (and likely calendar/bucket equivalents) call `confirm()`. §1 voice principle is "quiet by default" — the OS confirm() popup is the loudest possible UI. Replace with a `BottomSheet`-anchored confirm or with an inline two-step pattern (the settings page already does this well: `confirmUnpair = $state(false)` → reveals confirm/cancel pair, see `src/routes/settings/+page.svelte:309-328`). Reuse that pattern.

### 1.11 [P3] Hardcoded color literals (anti-pattern §13)

- `src/lib/components/pet/CoinIcon.svelte:29-45` — SVG fills `#f4c66b`, `#b9881f`, `#7a5a13`, `#5a4209`. Acceptable iff coin is intentionally outside the theme; otherwise tokenize into `--coin-{shine,base,shadow,outline}` or use CSS `currentColor` + opacity.
- `src/routes/map/+page.svelte:119` — `'rgba(244, 177, 160, 0.5)'` for the Leaflet polyline. Leaflet's API needs a string, but you can read `getComputedStyle(document.documentElement).getPropertyValue('--color-primary')` once and `color-mix` to 50% alpha. Or define `--map-trace` as a CSS var and resolve it at module-init.

### 1.12 [P3] `bg-primary/12` arbitrary opacity

`BottomNav.svelte:97`, `auth/sign-in/+page.svelte:34`, `auth/check-email/+page.svelte:17` use `bg-primary/12`. Tailwind v4 supports arbitrary alpha (it compiles to `color-mix`), and design guide §7.2 explicitly mentions "12 % opacity" — so this is intentional. Worth a screenshot check that it actually resolves on Cloudflare's prod build (it does in dev, see active-tab pill in `mobile-11-pulse.png`).

---

## 2. Per-route findings

Cited screenshots live in `/tmp/duosync-review/screenshots/`.

### 2.1 `/welcome` (anon)

- `src/routes/welcome/+page.svelte` — uses scoped `<style>` (lines 114-200) with `padding`, `gap`, custom keyframes, instead of Tailwind utilities. **The only anon page that does this.** Migrating it would let it inherit theme switching for free (currently it's hardcoded to a single look). See `anon-mobile-01-welcome.png` vs `anon-desktop-01-welcome.png` — both look identical because the CSS is scoped and unaware of `data-theme`. **[P2]**
- The `setInterval(tick, 1000)` polling `canInstall()` is wasteful — `BeforeInstallPromptEvent` fires when install becomes available; subscribe to that event instead. Anti-pattern §13's "no polling" rule applies. **[P2]**

### 2.2 `/auth/sign-in` (anon)

- Tab control at `auth/sign-in/+page.svelte:34` uses two `<button role="tab">` elements without a `<div role="tablist">` wrapper. Screen-readers will announce them as orphaned buttons. **[P2]**
- Inactive tab uses `bg-primary/12` ✓. Otherwise solid — uses `InputField` and `PillButton`.

### 2.3 `/auth/check-email` (anon)

Visible in `anon-mobile-02b-check-email.png`. Static body, single CTA. Clean. No findings.

### 2.4 `/onboarding`

`src/routes/onboarding/+page.svelte`. Uses `InputField`, `PillButton`, `Notice` ✓. Avatar grid (lines 76-93) uses `transition-all` (`peer-checked:scale-110 peer-checked:border-primary`). §13 doesn't ban `transition-all` but it's broad — `transition-transform` would be tighter. **[P3]**

### 2.5 `/pulse`

Visible in `mobile-11-pulse.png` and `desktop-11-pulse.png`.

- "Waiting for fix" appears **twice** in the hero — once as the Fraunces display headline inside the breathing ring, once as the ALL-CAPS subtitle below. Either drop the subtitle or repurpose it ("we'll surface a heartbeat as soon as one arrives"). **[P2]**
- The HeartbeatZone wrapper at `+page.svelte:406-412` sets `padding-bottom: calc(env(safe-area-inset-bottom) + 4.5rem)` to clear the BottomNav. Magic 4.5rem = the BottomNav height. If BottomNav grows / shrinks, pulse breaks. Either expose `--bottom-nav-h` from `+layout.svelte` (preferred — single source of truth) or document the coupling. **[P2]**
- Two stacked fixed-bottom layers (HeartbeatZone z-20 + BottomNav z-30) — works visually but is fragile. **[P3]**
- Mood face row uses 5 colored variants — verify the leftmost (orange/yellow) and rightmost (rose) aren't using `--color-error` for the negative face. (Couldn't confirm without reading `MoodFace.svelte` — flag for next session.) **[P3]**

### 2.6 `/map`

Visible in `mobile-12-map.png`, `desktop-12-map.png`.

- Forced dark theme (per `+layout.svelte` `ROUTE_THEME`) ✓ — matches design guide §6 map-mode rule.
- "Center on us" FAB sits at `bottom-28` — magic number to clear the BottomNav. Same fix as §2.5: expose `--bottom-nav-h`. **[P2]**
- No error / loading state if the dynamic Leaflet import fails. Network drop on first visit shows a blank dark plate. **[P2]**
- Polyline color hardcoded — see §1.11.
- `aria-label="Primary"` on the map container ✓.

### 2.7 `/daily`

Uses `Spinner` for submit ✓. No findings beyond cross-cutting (no obvious shadow / color drift).

### 2.8 `/moments`

Visible in `mobile-14-moments.png`.

- Empty state present ✓ (Sparkle icon + copy).
- Delete button 28 px tall + `text-error` hover (`+page.svelte:157`) — see §1.3 + §1.8. **[P1]**
- `MomentCard` (`src/lib/components/duosync/MomentCard.svelte`) is clean — uses tokens, `shadow-paper`, design-system colors.

### 2.9 `/moments/new`

Visible in `mobile-14b-moments-new.png`. Forced dark via `ROUTE_THEME`. Uses `InputField`, `Slider`, `PillButton`, `Notice` ✓. No findings.

### 2.10 `/timeline`

Empty-state present ✓. No findings.

### 2.11 `/notes`

Visible in `mobile-16-notes.png`. Three findings collapse to: §1.4 (`shadow-sm` ×2), §1.3 (`text-error` ×2), §1.5 (raw daisyUI textarea), §1.8 (`btn-xs` cancel), §1.10 (`confirm()` at line 61). Empty state is **text-only** — design opportunity for a small illustration or sparkle icon. **[P2]**

### 2.12 `/calendar`

Visible in `mobile-17-calendar.png`. Same drift cluster as `/notes`: `shadow-sm` (line 214), `text-error` (lines 190, 253), raw daisyUI date input. Text-only empty state. **[P1 — same fixes]**

### 2.13 `/bucket`

Visible in `mobile-18-bucket.png`. Same drift cluster: `shadow-sm` (134, 186), `text-error` (119, 163, 202), raw daisyUI input. Text-only empty state. **[P1 — same fixes]**

### 2.14 `/chat`

Visible in `mobile-19-chat.png`.

- Composer is a raw `<textarea>` with bespoke classes (line 268) instead of `InputField rows={1}`. Probably intentional because of the `min-h-10 max-h-32 resize-y` autosize behavior — `InputField` doesn't support that. Either extend `InputField` with an `autosize` prop or document the exemption. **[P2]**
- Send button is `h-10 w-10` = 40 px — fails §10.2 (44 px). Bump to `h-11 w-11`. **[P1]**
- `ring-error/60` on failed-message bubble (line 229) — debatable §1.3, but a delivery failure is genuinely an error condition. Acceptable.
- `aria-live="polite"` on the message list ✓.

### 2.15 `/quiz`

Visible in `mobile-20-quiz.png`. `hover:shadow-md` (line 39) — see §1.4. Otherwise clean.

### 2.16 `/repair`

Visible in `mobile-21-repair.png`. Uses `Card`, `PillButton`, `InputField`, `SectionHeader`, `Spinner`, `Notice` ✓. `text-error` for `cancelled` status pill (`+page.svelte:87`) — borderline §1.3 (could be `text-warning`). `setInterval` for the cooldown countdown (line 44) — legitimate use (clock display). **[P3]**

### 2.17 `/settings`

Visible in `desktop-30-settings.png` and `mobile-30-settings.png`.

- Card-heavy layout, uses `Card`, `SectionHeader`, `PillButton`, `InputField`, `ChoiceChip`, `Toggle`, `Notice`, `Spinner` ✓. Best-behaved page in the app.
- `text-error` on UNPAIR + DELETE ACCOUNT section titles (lines 303, 392) — see §1.3 (probably acceptable).
- "Avatar emoji" input renders as a 100% width text input with a single emoji floating left — visually awkward, see desktop screenshot. Consider an emoji picker or a smaller width. **[P2]**
- The "View milestone timeline →" button (line 274-279) is a styled `<a>` not `PillButton` — minor consistency drift. **[P3]**
- Diagnostics list uses `<a>` rows with `CaretRightIcon` — clean iOS-style list. ✓

### 2.18 `/settings/activity`

Visible in `mobile-31-settings-activity.png`. Clean — uses tokens, `Icon`, design-system colors. No findings.

### 2.19 `/settings/offline-queue`

See §1.2 + §1.6 — needs full rewrite.

---

## 3. Component-level audit

### Strong primitives (no changes needed)

- `PillButton` — encodes 6 variants × 3 sizes; enforces `min-h-11`/`min-h-12`. `src/lib/components/ui/PillButton.svelte`.
- `InputField` — paper-dialect input with raised/sunken tones. `src/lib/components/ui/InputField.svelte`.
- `Card`, `SectionHeader`, `Notice`, `Spinner`, `ChoiceChip`, `Toggle` — consistent token use across all routes that adopt them.
- `MomentCard` — clean.

### Drift offenders

- `BottomNav` — see §1.1, §1.9 friend (focus rings on tab links: lines 88-94 use `transition-colors` with no `focus-visible` ring). **[P2]**
- `BackButton` — see §1.8, §1.9.
- `QueueBadge`, `UpdatePromptBanner` — see §1.2.
- `CoinIcon` — see §1.11.

### Components not yet audited (next session)

`MoodPicker`, `MoodFace`, `MoodTrendStrip`, `MoodWeather`, `DistanceBubble`, `PartnerAvatar`, `IosInstallSheet`, `CodeScanner`, `PushSubscribeCard`, `StreakBadge`, `Tabs`, `Toggle` (deep), `Slider` (deep), `BottomSheet`, `MemoryResurface`, `AnniversaryRibbon`, `GhostBanner`, `HeartbeatZone`. Spot-check these before any major theme work.

---

## 4. Mobile-specific findings (375 px viewport)

- BottomNav at 5 tabs is crowded — see §1.1.
- `/pulse` hero ring is very large; "Waiting for fix" copy duplicated — see §2.5.
- Touch targets <44 px — see §1.8 (BackButton, moment delete, btn-xs in notes/calendar/bucket, chat send button).
- `confirm()` browser dialogs feel especially jarring on mobile — see §1.10.

## 5. Desktop-specific findings (1280 px viewport)

- **All authed pages use `max-w-md` (448 px)** centred on a 1280 px viewport — see `desktop-11-pulse.png`, `desktop-30-settings.png`. This is **intentional per §6 of the design guide** ("mobile-first, centered shell on desktop") but worth flagging because it produces ~700 px of empty gutters. If a desktop expansion is ever planned, `/map` is the obvious first canvas (already full-bleed).
- BottomNav remains visible on desktop. The full-page screenshot trick produces a Playwright artefact where the nav appears to float mid-page (`desktop-30-settings.png`) — **this is a screenshot rendering artefact, not a real bug** (the nav is `position: fixed` and stays at viewport bottom in a real session). Worth verifying once with a real desktop browser.
- `/settings/offline-queue` desktop layout (`desktop-32-settings-offline-queue.png`) widens to `max-width: 640px` — inconsistent with every other page's 448 px. **[P3 — pick one]**

## 6. Design-system drift summary

| Token / Convention | Should be                        | Found also as                                                          | Where     |
| ------------------ | -------------------------------- | ---------------------------------------------------------------------- | --------- |
| Color              | `--color-*` (canonical)          | `--ds-color-*` (undefined → hex)                                       | §1.2      |
| Color              | `text-warning` for non-fatal     | `text-error`                                                           | §1.3      |
| Shadow             | `shadow-paper`                   | `shadow-sm`, `hover:shadow-md`                                         | §1.4      |
| Inputs             | `<InputField>`                   | `<input class="input-bordered ...">`                                   | §1.5      |
| Buttons            | `<PillButton>`                   | bare `<button>` (offline-queue)                                        | §1.6      |
| Confirm            | inline reveal pattern (settings) | `confirm()` browser dialog                                             | §1.10     |
| Touch target       | ≥44 px (`min-h-11`)              | `h-9` (BackButton), `h-7` (moments delete), `btn-xs`, chat send `h-10` | §1.8      |
| Container width    | `max-w-md`                       | `max-w-2xl` (quiz), `max-width: 640px` (offline-queue scoped)          | §2.15, §5 |

---

## 7. Quick wins (≤30 min each)

1. **Decide BottomNav contract** — drop `/daily` from tabs OR amend `docs/ui-design.md` §7.2. One commit.
2. **Bump `BackButton` to `h-11 w-11`** and add `focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none`. One file.
3. **Mass-replace `shadow-sm` → `shadow-paper`** in `notes`, `calendar`, `bucket`, `quiz`. ~5 lines.
4. **Bump chat send button** `h-10 w-10` → `h-11 w-11` at `src/routes/chat/+page.svelte:274`.
5. **Bump moments delete button** `h-7 w-7` → `h-9 w-9` (or `h-11 w-11`) and swap `text-error` → `text-base-content/50` at `src/routes/moments/+page.svelte:157`.
6. **Replace `text-error` with `text-warning` (or `text-base-content/60`)** on toasts/cancel buttons in notes/calendar/bucket. ~6 sites.
7. **Add `--ds-color-*` aliases** in `src/routes/+layout.css` pointing at `--color-*` so the three offending files render correctly while a longer migration is planned.

## 8. Bigger lifts

1. **Rewrite `/settings/offline-queue`** with `Card`, `SectionHeader`, `PillButton`, `Notice` — kills §1.2 + §1.6 in one commit. ~30 minutes if you steal markup from `/settings/activity`.
2. **Migrate `notes`, `calendar`, `bucket`** to `<InputField rows={n}>` and `<PillButton variant="ghost"|"danger">` for the cancel/delete chips. ~1 hour.
3. **Replace `confirm()` calls** with the inline-reveal pattern from `/settings` (`confirmUnpair` / `confirmDelete`). Reusable `<ConfirmInline>` component candidate.
4. **Unify the `--ds-color-*` namespace** with `--color-*` and remove `<style>` blocks from `QueueBadge`, `UpdatePromptBanner`, `/settings/offline-queue`. Ports them into Tailwind utilities and removes per-component dark-mode hand-rolling.
5. **Design proper empty-state illustrations** for `/notes`, `/calendar`, `/bucket` — tiny SVG + one-line copy. `/moments` and `/timeline` already have the pattern; copy it.
6. **Fix the dev CSP nuisance** (§1.7) — emit the inline pre-paint script's hash from the build into the CSP at SSR time. Single PR.
7. **Migrate `/welcome` from scoped `<style>` to Tailwind** so it inherits theme switching.
8. **Replace polling in `/welcome`** (§2.1) with the `beforeinstallprompt` event listener.
9. **Expose `--bottom-nav-h`** as a CSS var on `:root` (or on `<body>` from `+layout.svelte`) so `/pulse` HeartbeatZone and `/map` FAB stop hardcoding `4.5rem` / `bottom-28`.

## 9. Notes for the next session

- This document is meant to be **consumed and pruned** — strike findings as you fix them.
- Regen the screenshots + `findings.json` with `node /tmp/duosync-review/walk.mjs` after major UI changes.
- `screenshots/` and `findings.json` live in `/tmp/duosync-review/` (not committed) — they survive the session via the walker but you'll need to re-run after a sandbox refresh.
- Components I didn't get to (see §3 list) — sweep them next pass; especially `MoodFace` (suspect `--color-error` for the negative face), `Slider`, `BottomSheet`, `IosInstallSheet`.
- Top-5 highest-severity items, in order:
  1. **§1.6** `/settings/offline-queue` rewrite (P0).
  2. **§1.1** BottomNav 5-vs-4 contract drift (P1).
  3. **§1.2** `--ds-color-*` undefined namespace (P1).
  4. **§1.3** `text-error` overuse in non-SOS contexts (P1).
  5. **§1.5 + §1.4** raw daisyUI inputs + `shadow-sm` in notes/calendar/bucket (P1).

---

## 14. Information architecture review — design system needs an update

> Section added in response to: "the tabs below is not enough — where do you put the other pages? how does it make it feel intuitive?" Findings here justify normative edits to `docs/ui-design.md` §7.2 and §8 before any further routes ship.

### 14.1 [P0] The IA is broken — features have no front door

Live route surface (19 routes) vs. discoverability:

| Route | In BottomNav | Linked from a hub page | Reachable only by URL? |
| --- | :---: | --- | :---: |
| `/pulse`, `/map`, `/daily`, `/moments`, `/settings` | ✅ tab | — | — |
| `/timeline` | — | `/pulse:236`, `/settings:275` | — |
| `/pet` | — | `/pulse:251,266` | — |
| `/notes` | — | `/settings:369` (junk drawer) | — |
| `/calendar` | — | `/settings:355` (junk drawer) | — |
| `/bucket` | — | `/settings:348` (junk drawer) | — |
| `/chat` | — | `/settings:362` (junk drawer) | — |
| **`/quiz`** | — | **none** | **🔴 yes** |
| **`/repair`** | — | **none** | **🔴 yes** |

Three implications:

1. **`/quiz` and `/repair` are dark routes** — implemented, tested, but unreachable from any UI surface. A user opening the app cold cannot find them.
2. **`/settings` is misused as an app launcher** (lines 275–369). Settings is for configuration (account, notifications, theme, ghost mode) — putting `Notes`, `Calendar`, `Bucket`, `Chat`, `Timeline` there violates §1 ("quiet by default") and §7.2 BottomNav contract ("Settings = config tab"). It also creates two paths to the same feature, which dilutes the mental model.
3. **`SECONDARY_PARENT` map** (`BottomNav.svelte:55-63`) declares `chat/quiz/repair → /daily` and `timeline/notes/calendar/bucket → /moments`, but **neither parent page surfaces those children**. The contract is one-way (active-tab-lighting on the way down, no entry points on the way back). User would have to leave the app and return via deep link.

### 14.2 The real feature map

Group routes by mental model, not by URL:

```
Now (live, synchronous)        →  /pulse  /map  /chat
Today (relationship rituals)   →  /daily  /quiz  /repair  /pet
Memory (asynchronous record)   →  /moments  /timeline  /notes
Plan  (forward-looking)        →  /calendar  /bucket
You   (config)                 →  /settings (+ /settings/activity, /settings/offline-queue)
```

Five hubs, not four. The design guide §7.2 still says "4 tabs" and BottomNav.svelte ships 5 (and the 5th, `/daily`, doesn't act as a hub for `/quiz`/`/repair`/`/pet`). Both are wrong against the live surface.

### 14.3 Three IA options for `docs/ui-design.md`

#### Option A — 5-tab hub-and-spoke (smallest change)

BottomNav: **Pulse · Today · Moments · Plan · You** (rename `Settings → You`). Each parent page exposes its children as a horizontal chip-row at the top, below `PageHeader`:

- `/today` (renamed `/daily`) — chips for `Daily question`, `Chat`, `Quiz`, `Repair`, `Pet`. Default landing = the daily-question card.
- `/moments` — chips for `Feed`, `Timeline`, `Notes`. Default = feed.
- `/plan` (NEW shell at `/plan/+page.svelte` that 303s to `/calendar`) — chips for `Calendar`, `Bucket`.
- `/you` (renamed `/settings`) — current sub-tabs.
- Drop the junk-drawer links from `/settings:275-369`.

**Pros:** smallest code delta, preserves muscle memory for existing users, makes orphaned routes discoverable, settings goes back to being settings.
**Cons:** 5 tabs at 360px is tight (still works at `text-[11px]`); requires renaming `daily → today` and adding a `/plan` shell route.

#### Option B — 4-tab + persistent rail FAB

Keep the original 4 (`Pulse · Map · Moments · Settings`) as in current §7.2. Add a **circular FAB at thumb-bottom-centre** that opens a radial sheet ("today menu") with `Daily / Chat / Quiz / Repair / Pet`. The FAB is the "today" entry point — it animates with the breathing pill currently used for active tab.

**Pros:** preserves the 4-tab promise; the FAB is clearly the "do something with us" anchor (matches §1 "primary action lives in bottom third").
**Cons:** new pattern (radial sheet) needs a contract in §7; map and moments still don't expose timeline/notes/calendar/bucket — those would need a different home (probably a chip-row inside `/moments` and a new `/plan` hub, partially negating the option).

#### Option C — Two-tier nav: 4 tabs + per-screen secondary chips

Keep BottomNav at 4 (`Pulse · Map · Moments · You`). Promote `/daily`, `/calendar`, `/bucket`, `/timeline`, `/notes`, `/chat`, `/quiz`, `/repair`, `/pet` to **chips inside their natural hub**:

- `/pulse` gets a chip-row at the bottom (above HeartbeatZone): `Today · Pet · Chat · Repair`.
- `/moments` gets a chip-row at the top: `Feed · Timeline · Notes · Calendar · Bucket`.
- Map stays focused (no chips — it's a meditation surface).

**Pros:** fewest BottomNav tabs (matches §7.2), each chip-row is contextual and localized.
**Cons:** chip-rows on `/pulse` violate §6 ("primary action lives in the bottom third — top of viewport is for ambient information only"); also `/pulse` already has DistanceBubble + PartnerAvatar + MoodWeather + HeartbeatZone — vertical budget is exhausted.

### 14.4 Recommendation

**Option A**, with these specific edits to `docs/ui-design.md`:

1. **§7.2 `BottomNav` contract** — rewrite "4 tabs" → "5 tabs: Pulse · Today · Moments · Plan · You. Each non-Pulse tab is a *hub* — a landing surface that exposes its sub-routes via a chip-row at the top, below `PageHeader`."
2. **§8 IA table** — add rows for `/today`, `/quiz`, `/repair`, `/chat`, `/pet`, `/timeline`, `/notes`, `/calendar`, `/bucket`, mark each with its hub parent. Remove "deferred (Phase: settings/theme)" notes that are no longer accurate.
3. **§7 — add a new contract `HubChips`** (a `ui/` primitive): horizontal scroll-snap row of chips, each `min-h-44px`, active chip uses `bg-primary/12` + `aria-current="page"`, inactive chips are `bg-base-200`. Reduced-motion safe (no scroll animation). One per hub.
4. **§13 anti-patterns** — add: "Linking a content route from `/settings`. Settings is configuration only; content features must live under their hub."
5. **§6 layout** — add: "BottomNav clearance is `pb-28` (112px) on hub pages with chip-rows, `pb-24` (96px) on leaf pages without." (Replaces the magic `bottom-28` and `4.5rem` spread across components flagged in §1.7.)

### 14.5 New components/routes implied

- `src/lib/components/ui/HubChips.svelte` (new primitive)
- `src/lib/components/duosync/HubHeader.svelte` (composes `PageHeader` + `HubChips`)
- `src/routes/plan/+page.server.ts` (303 → `/calendar`) — or a real `/plan` index showing both `Calendar` upcoming + `Bucket` recent items as a 2-card grid
- Rename `/daily` → `/today` (keep a `/daily` redirect for muscle memory)
- Rename `/settings` → `/you`? — bigger lift, may be Phase-2; keep the route at `/settings` and just relabel the BottomNav tab text via Paraglide (`m.nav_settings()` already exists; add `m.nav_you()` and switch).

### 14.6 Migration order

1. Update `docs/ui-design.md` §7.2 + §8 + §13 + add §HubChips contract — the design system change is the gate.
2. Build `HubChips` primitive + Storybook stories.
3. Build `HubHeader` and adopt it on `/today` (renamed daily), `/moments`, `/plan`.
4. Remove junk-drawer links from `/settings:275-369`.
5. Add `BottomNav` 5th tab (`Plan`) and rename `Daily → Today`. Update `SECONDARY_PARENT` map.
6. Add e2e: from cold app launch, every authed route is reachable in ≤2 taps (BottomNav + chip).

