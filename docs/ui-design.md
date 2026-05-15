# DuoSync — UI Design Guide

> **Scope.** Single source of truth for the DuoSync visual + interaction language.
> Every screen, component and animation in this app must trace back to a rule
> in this document. If something on screen does not, either this guide is
> missing a rule (PR a new one) or the screen is wrong (PR a fix).
>
> **Audience.** Future humans and agents touching `src/lib/components/**`,
> `src/routes/**` or `src/routes/layout.css`.
>
> **Status.** Living document. The token block, motion catalogue, and
> component contracts are normative. Visual mockups in `docs/ui-design/*.png`
> are illustrative reference only — when they disagree with this file, this
> file wins.

---

## 1. Product voice — "passive presence"

DuoSync is a two-person sanctuary. Every UI decision must answer the same
filter:

> Does this make my partner feel **closer** without making them feel
> **watched**?

Practical rules that fall out of this:

- **Quiet by default.** No red badges. No loud alarms. Only the SOS Beacon
  may use `--color-error`.
- **Texture > motion > color > text** as the order of expressive priority.
  Texture (e.g. paper grain, dotted ring) ages best on bad displays and
  reduced-motion users.
- **Numerals are emotional.** Distance, day count, ETA all use the
  display serif (Fraunces). Body and UI use the neutral sans (Inter).
- **Both partners see the same thing.** No "you/them" asymmetry in the
  Distance Bubble, in moments cards, in the map. Symmetry is the bond.
- **Reduced-motion is a first-class theme**, not a fallback. Anything
  whose meaning relies on motion (Distance Bubble breathing, presence
  pulse, ripple) must also encode that meaning in colour, texture or text.

---

## 2. Themes

Two DaisyUI 5 themes live in `src/routes/layout.css`. Both are normative —
do not introduce a third without updating this section.

| theme                          | when                                                            | base feel                                         |
| ------------------------------ | --------------------------------------------------------------- | ------------------------------------------------- |
| `duosync-light` (default)      | `/pulse`, `/moments`, `/onboarding`, `/settings`, all marketing | cream paper, dusty rose, sage. Daylight intimacy. |
| `duosync-dark` (`prefersdark`) | `/map`, `/moments/new`, any future "deep focus" surface         | midnight + slate, warm peach + mist. Quiet night. |

**Switching rules.**

- The whole app respects the OS preference by default (DaisyUI `prefersdark`).
- A route may **force** a theme via `<svelte:head>`/`document.documentElement.dataset.theme`. Only `/map` and `/moments/new` are allowed to do this today.
- Per-user preference (Phase: settings/theme) MUST be applied **before first
  paint** to avoid the dark→light flash. Use `+layout.svelte` `onMount`
  reading `localStorage` synchronously, not a server roundtrip.

### Token surface (canonical names)

These come from `src/routes/layout.css` and are the only colours allowed in
new code. Hex literals in components are a review block.

```
--color-base-100   page background (cream / midnight)
--color-base-200   surface / card  (paper white / slate)
--color-base-300   subtle divider, hover
--color-base-content   primary ink  (warm ink / cream ink)

--color-primary    dusty rose (light) / warm peach (dark)
                   → CTAs, anniversary ribbon, active nav
--color-secondary  sage / mist blue
                   → "near" bucket, success-adjacent affirmations
--color-accent     warm gold (both themes)
                   → "same place" / milestone glow
--color-info       mist blue (both themes)
                   → "far" bucket, neutral hints
--color-warning    warm gold (both themes)
                   → soft alerts (low battery, expiring link). Never alarming.
--color-success    sage (both themes)
                   → mirror of `--color-secondary` for affirmative confirmations
--color-error      muted red (light) / soft red (dark)
                   → SOS beacon ONLY
```

Distance bucket vars (in `:root` and re-exposed via `@theme`):

```
--distance-same   warm gold   (#f4c97a)  → bucket 'together'
--distance-near   sage        (#9bb89f)  → bucket 'near'
--distance-city   dusty rose  (#e07a8f)  → bucket 'same_city'
--distance-far    mist blue   (#8fa9b8)  → bucket 'far'
--distance-ghost  slate       (#6b5d52)  → ghost mode override
```

> Bucket-to-colour mapping is part of the product trust model
> (warm = close, cool = far). Do not swap these in components.

### Shape and shadow

```
--radius-bubble   9999px      circular bubble (Distance Bubble)
--radius-card    1.25rem      paper card corners
--radius-box     1.25rem      DaisyUI default
--radius-field   0.75rem      inputs, selects
--radius-selector 1rem        chips, pill toggles
--shadow-paper   layered low-blur shadow with warm-brown tint
                 → ALL elevated paper surfaces
```

`shadow-paper` is the only sanctioned elevation. No DaisyUI `shadow-md`,
no Tailwind `shadow-xl`. Match the paper feel.

---

## 3. Typography

Two families, served by Google Fonts (`<link>` in `src/app.html`).

| variable         | family                           | use                                                       |
| ---------------- | -------------------------------- | --------------------------------------------------------- |
| `--font-sans`    | **Inter** 400/500/600/700        | All UI: nav, buttons, body text, captions                 |
| `--font-display` | **Fraunces** opsz 9-144, 400/600 | Numerals (distance, days, milestones), 1-3 word headlines |

Always invoke the display family via the `.text-display` utility (not
inline `font-family`) — that utility also applies the optical-size axis
and `ss01` stylistic set:

```html
<p class="text-display text-6xl">{distance}<span class="text-2xl">m</span></p>
```

### Type ramp (recommended)

| token                                | size / leading | use                                 |
| ------------------------------------ | -------------- | ----------------------------------- |
| `text-6xl` + `text-display`          | 60px / 1       | Distance Bubble numeral             |
| `text-5xl` + `text-display`          | 48px / 1       | Anniversary big day count           |
| `text-2xl` + `text-display`          | 24px / 1.2     | Distance unit, milestone            |
| `text-xl`                            | 20px / 1.4     | Page titles                         |
| `text-base` (default)                | 16px / 1.5     | Body, list items                    |
| `text-sm`                            | 14px / 1.4     | Secondary, captions                 |
| `text-xs`                            | 12px / 1.4     | Metadata, last-seen                 |
| `text-[11px] tracking-wide`          | 11px           | Bottom nav labels (this exact size) |
| `text-xs tracking-[0.2em] uppercase` | 12px           | Bubble sub-label, section eyebrows  |

Localized text expansion: Traditional Chinese strings ≤12 characters in
nav and primary buttons. Tested in `messages/{en,zh-cn,zh-hant}.json`.

---

## 4. Iconography

- Library: **`phosphor-svelte`** with `weight="duotone"` (default) or
  `weight="fill"` for active states. No other icon set.
- Curated re-exports for icons used 2+ times: `src/lib/components/ui/icons.ts`.
- One-off icons import directly from `phosphor-svelte/lib/<Name>Icon`
  to keep tree-shaking per-route.
- Default size: `24` for nav and inline body, `22` for bottom nav.
- All icons render through `<Icon icon={...}>` (`src/lib/components/ui/Icon.svelte`)
  so weight/size are uniform.

Emoji are allowed only as **content** (avatar, mood weather glyphs, ghost 👻,
sparkle ✨ on FABs). They are not interactive icons — never substitute an
emoji for a Phosphor icon in a button.

---

## 5. Motion language

CSS keyframes in `src/lib/motion/animations.css`. JS primitives in
`src/lib/motion/`. Imported once globally from `+layout.svelte`.

| utility                   | timing                                      | use                                          |
| ------------------------- | ------------------------------------------- | -------------------------------------------- |
| `.animate-breathe`        | 4s ease-in-out infinite                     | Distance Bubble outer ring, active nav pill  |
| `.animate-presence-pulse` | 2s ease-in-out infinite                     | Partner avatar presence dot when online      |
| `.animate-ripple`         | 0.85s `cubic-bezier(0.22, 1, 0.36, 1)` once | Heartbeat tap ripple                         |
| `.animate-bloom`          | 1.2s spring once                            | Onboarding pairing success, milestone unlock |
| `.animate-map-pin-pulse`  | 2.4s ease-in-out infinite                   | Halo under partner/self pins on `/map`       |

**Hard rules.**

1. **Composited only.** Animate `transform` and `opacity`. Never `width`,
   `height`, `top`, `left`, `box-shadow` (other than `currentColor` ring),
   `background`. The reduced-motion reset assumes this.
2. **Reduced-motion override is global** (in `layout.css`). All durations
   collapse to `0.001ms`. Components must therefore not rely on motion to
   convey state — see §1.
3. **Haptics pair with motion**, never replace it. Use `vibrate(...)` from
   `$lib/motion/vibrate` with the named patterns:
   - `TAP_LIGHT` — confirm a tap (toggle, chip)
   - `TAP_HEARTBEAT` — heartbeat zone double-tap
   - `BUZZ_ALERT` — SOS beacon only
   - `BUZZ_BLOOM` — pairing success
4. **No new animations** without adding both a keyframe entry here and in
   `animations.css`. The list is the contract.

---

## 6. Layout & spacing

- **Mobile-first.** Design for 360×640 (small Android) up to 430×932
  (iPhone Pro Max). Tablet and desktop are scaled-up centred views, not
  separate layouts.
- **Single thumb-reach.** Primary action lives in the bottom third of the
  viewport. The top of the viewport is for ambient information (Anniversary
  Ribbon, status pills) only.
- **Safe-area insets are mandatory.** `body` already gets the four
  `--safe-*` paddings. Fixed elements (BottomNav, FAB, sheets) must add
  `padding-bottom: env(safe-area-inset-bottom)` themselves.
- **Max content width** for centred surfaces: `max-w-md` (28rem). Never
  full-width text on tablet — readability collapses.
- **Spacing scale**: use Tailwind `space-{1..6}` (4px → 24px). Larger gaps
  (32px+) only in hero sections.
- **BottomNav clearance.** Routes that render `BottomNav` must add bottom
  padding to their primary `<main>` so content scrolls above the nav.
  - Hub pages (with `HubChips` row above the nav): `pb-32` (128px).
  - Leaf pages (no chip row): `pb-24` (96px).
  - Routes that hide BottomNav (auth, onboarding, `/welcome`, `/moments/new`): no extra padding.
  - Magic values (`bottom-28`, `4.5rem`) in components are forbidden — use the tokens above.

---

## 7. Component library

Components live in two folders. The split is structural, not cosmetic.

```
src/lib/components/
├── ui/         primitive wrappers around bits-ui, no DuoSync brand
└── duosync/    brand-shaped, opinionated, compose ui/ + motion
```

Routes import only from the barrel `'$lib/components/duosync'`. Add new
exports there.

### 7.1 `ui/` — primitives

Headless behaviour from **bits-ui**, styled with our tokens.

| component            | role                                                      |
| -------------------- | --------------------------------------------------------- |
| `Icon.svelte`        | Sole entry point for Phosphor icons (size, weight, class) |
| `BottomSheet.svelte` | Drag-to-dismiss sheet (bits-ui Dialog)                    |
| `Slider.svelte`      | Radius slider, generic range input                        |
| `Tabs.svelte`        | Settings sub-sections                                     |
| `Toggle.svelte`      | Ghost mode, notification toggles                          |
| `HubChips.svelte`    | Horizontal scroll-snap chip row for hub sub-navigation    |

If you need a primitive (popover, dropdown, command), add a thin wrapper
under `ui/` first; do not pull bits-ui directly into a duosync/ component.

#### `HubChips` (primitive)

- **Inputs:** `chips: Array<{ href: string; label: () => string; icon?: Component }>`, `current: string` (the active route — typically `page.url.pathname`).
- **Visual:** horizontal `scroll-snap-x` row, `gap-2`, full-bleed left/right with `px-4` content padding. Each chip is a pill with `min-h-[44px]` (a11y §10.2), `rounded-selector`, `text-sm` (Inter), optional 16px Phosphor icon. Active chip uses `bg-primary/12` + `text-base-content` + `aria-current="page"`. Inactive chips use `bg-base-200` + `text-base-content/70`.
- **Motion:** none. Scroll position is preserved by the browser; do not animate `scrollLeft`. Reduced-motion safe by construction.
- **Composition:** intended for use inside `HubHeader` (a `duosync/` component that pairs `HubChips` with the route title). A route may use `HubChips` standalone but must keep it directly below the page header (top of `<main>`), not floated.
- **Anti-pattern:** never put more than ~6 chips in a row — past that the row becomes a hidden menu. Promote one of the chips to a tab, or split the hub.

### 7.2 `duosync/` — domain components

Each component has a **contract** below. Future agents may extend them but
must not break the contract without bumping the relevant doc section.

#### `DistanceBubble`

- **Inputs:** `distanceM: number | null`, `bucket: DistanceBucket`, `ghost?: boolean`
- **Visual:** breathing radial-gradient ring + solid ring border + paper centre. Ring colour comes from `--distance-{bucket}` (or `--distance-ghost` if `ghost`).
- **A11y:** `aria-live="polite"`. Sub-label always renders the bucket word so reduced-motion + monochrome screens still convey the bucket.
- **Sizing:** `clamp(15rem, 70vw, 22rem)`, square aspect.
- **Bucket → colour mapping is fixed** (see §2). Do not parameterise.

#### `HeartbeatZone`

- Full-width invisible bottom strip. Double-tap within 350 ms inside it
  spawns a ripple at the tap coordinates and fires `TAP_HEARTBEAT` haptic.
- Hosts the `createHeartbeat` action from `$lib/motion/heartbeat.svelte`.
- Caller wires the `onTap` to `POST /api/realtime/tap` (server-validated
  broadcast — see `docs/rls-model.md`).

#### `PartnerAvatar`

- Shows partner emoji/img + presence dot + battery ring.
- Presence dot uses `.animate-presence-pulse` only when online; `away` and
  `ghost` states are static colour swatches.

#### `MoodWeather`

- Renders one of `'sunny' | 'cloudy' | 'rainy' | 'night'` with the matching
  Phosphor icon (`Sun`, `Cloud`, `CloudRain`, `Moon`) + localized caption.
- The mapping (mood → icon) is fixed in `index.ts`. Never swap.

#### `AnniversaryRibbon`

- Top-of-screen thin pill. Two slots: large day count (Fraunces) and
  next-milestone caption.
- Uses `--color-primary` background at 12% opacity; never solid.

#### `MemoryResurface`

- Yesteryear card. Blurred old thumbnail + "去年今日" eyebrow + body.
- Always a tap target; tapping opens the original moment route.

#### `MomentCard`

- Two states: `unlocked` (full body + author + map preview) and `locked`
  (`filter: blur(8px) saturate(.6)` on body + overlay
  "再走近 87m 即可閱讀 🚶"). Lock state is deterministic from
  `distanceM < radius_m`; do not store an unlocked flag client-side.

#### `BottomNav`

- **5 tabs**, fixed order: **Pulse · Map · Today · Moments · You**.
  - **Pulse** — live couple status (DistanceBubble, HeartbeatZone).
  - **Map** — both pins on a Leaflet canvas (forced dark theme, see §2).
  - **Today** — relationship rituals: daily question, chat, quiz, repair, pet. Route is still `/daily` for legacy/API reasons; the **tab label** is "Today" (key `m.nav_today()`).
  - **Moments** — past + future shared records: feed, timeline, notes, calendar, bucket. Hub page surfaces the children via `HubChips` (§7.1).
  - **You** — settings (account, ghost mode, notifications, theme, diagnostics). Route is `/settings`; the **tab label** is "You" (key `m.nav_you()`). **No content features under You** — see §13.
- Active tab gets the breathing pill (`.animate-breathe` over `bg-primary/12`) AND filled icon AND `aria-current="page"`. All three.
- Hidden by `+layout.svelte` for unauthenticated and unpaired routes.
- `SECONDARY_PARENT` map (in `BottomNav.svelte`) defines which tab lights up for non-tab routes:
  - `chat`, `quiz`, `repair`, `pet` → `/daily` (Today)
  - `timeline`, `notes`, `calendar`, `bucket` → `/moments`
  - `settings/*` → `/settings` (You)
  - Any new secondary route MUST be added here AND surfaced as a chip on the parent hub. Orphan routes (reachable only by URL) are a §13 anti-pattern.

#### `GhostBanner`

- Shown when self ghost mode is active. Includes countdown timer.
- Uses `--distance-ghost` slate. Never `--color-error`.

---

## 8. Screens (information architecture)

Every authed route must appear in the table below AND be reachable in
≤2 taps from a cold app launch (1 for hub tabs, ≤2 for hub children via
`HubChips`). Routes that violate this are §13 anti-patterns.

| route                                  | theme    | hub (BottomNav tab) | role                                                                             |
| -------------------------------------- | -------- | ------------------- | -------------------------------------------------------------------------------- |
| `/welcome`                             | light    | (anon) hidden       | marketing block                                                                  |
| `/auth/sign-in`, `/auth/check-email`   | light    | (anon) hidden       | form card                                                                        |
| `/onboarding`, `/onboarding/link`      | light    | hidden              | name + emoji + mood pickers, 6-char `LinkCode`, paired bloom                     |
| `/pulse`                               | light    | **Pulse** (tab)     | AnniversaryRibbon → DistanceBubble → PartnerAvatar → MoodWeather → HeartbeatZone |
| `/map`                                 | **dark** | **Map** (tab)       | Leaflet full-screen, two pins, distance curve, sheet                             |
| `/daily` (tab label "Today")           | light    | **Today** (tab)     | hub: daily question card + `HubChips` for children                               |
| `/chat`                                | light    | Today               | couple-only chat (7-day TTL)                                                     |
| `/quiz`, `/quiz/[id]`, `/quiz/run/[…]` | light    | Today               | "How well do you know me?" packs                                                 |
| `/repair`                              | light    | Today               | conflict-repair flow                                                             |
| `/pet`                                 | light    | Today               | shared pet habitat (Habitat / Shop / Wardrobe)                                   |
| `/moments`                             | light    | **Moments** (tab)   | hub: feed + `HubChips` for children                                              |
| `/moments/new`                         | **dark** | Moments             | mini-map + radius slider + caption + Drop FAB                                    |
| `/timeline`                            | light    | Moments             | full milestone history + upcoming countdowns                                     |
| `/notes`                               | light    | Moments             | shared notes                                                                     |
| `/calendar`                            | light    | Moments             | shared calendar (forward-looking dates)                                          |
| `/bucket`                              | light    | Moments             | shared bucket list                                                               |
| `/settings` (tab label "You")          | light    | **You** (tab)       | hub: account + ghost mode + notifications + theme                                |
| `/settings/activity`                   | light    | You                 | activity log                                                                     |
| `/settings/offline-queue`              | light    | You                 | offline action queue                                                             |
| `/settings/diagnostics/*`              | light    | You (hidden)        | diagnostics — never linked from primary surfaces                                 |

Every screen rule: **one primary action per view**. The Distance Bubble
on `/pulse` is information, not action; the only action on `/pulse` is
the heartbeat zone. The hub pages (`/daily`, `/moments`) treat
`HubChips` as navigation, not action — the primary action of a hub is
its own canonical content (e.g. answering today's daily question on
`/daily`).

---

## 9. Internationalization

- All user-visible strings flow through Paraglide (`messages/*.json`,
  generated `src/lib/paraglide/messages.js`). No hardcoded strings in
  components.
- Three locales: `en`, `zh-cn`, `zh-hant`. Keys MUST exist in all three
  with the same shape — CI parity check is a future TODO.
- Numerals are NOT translated — they're rendered with `Intl.NumberFormat`
  if needed, but most distances and day counts are bare integers.

---

## 10. Accessibility checklist

Every PR touching UI must pass these:

1. **Contrast** ≥ 4.5:1 for body text in both themes. Use the token names —
   the palette is pre-checked.
2. **Touch targets** ≥ 44×44 px. Bottom nav items are 56 px tall by design.
3. **Focus visible** — never `outline: none` without a replacement ring.
4. **`aria-current="page"`** on active nav.
5. **`aria-live="polite"`** on the Distance Bubble (it changes during a
   session).
6. **Reduced-motion safe** — see §5.1.
7. **Single source of truth for state** — server-derived booleans
   (e.g. lock state on `MomentCard`) are computed, not stored, on the
   client.

---

## 11. Adding a new component or screen

1. Decide: primitive (`ui/`) or domain (`duosync/`)? If it has DuoSync
   colours/personality baked in, it's domain.
2. Create the `.svelte` file with the documentation header block,
   following the pattern in `DistanceBubble.svelte`.
3. Add a `.stories.svelte` next to it. Cover at least the visual states
   listed in the contract (e.g. all five distance buckets, both themes).
4. Export from `index.ts` if domain.
5. Add or update the contract in §7 of this guide.
6. Run `bun run check`, `bun run lint`, `bun run build`, `bun run storybook`.
7. Atomic commit per logical unit.

---

## 12. Visual reference

Mockups generated for the original design brief live alongside this
guide:

```
docs/ui-design/
├── mood-board-1.png … mood-board-4.png       (visual mood)
└── flow-sheet-1.png  … flow-sheet-5.png      (4-screen flow)
```

These are reference only. When tokens or rules in this document
disagree with a mockup, **this document wins** — the mockups predate
the live token sheet in `layout.css`.

---

## 13. Anti-patterns (review blocks)

A PR doing any of these will be sent back:

- Hex colour literal in a component (`color: '#e07a8f'`). Use a token.
- New `@keyframes` outside `src/lib/motion/animations.css`.
- Direct `phosphor-svelte/lib/...` import in a `duosync/` component
  for an icon already in `ui/icons.ts`.
- DaisyUI `shadow-md` / Tailwind `shadow-lg`. Use `shadow-paper`.
- `--color-error` for anything other than the SOS beacon.
- A new `data-theme` value beyond `duosync-light` / `duosync-dark`.
- A component that requires JS for its meaning to be accessible
  (i.e. fails when motion + JS are off).
- Hardcoded user-visible text (no Paraglide key).
- `setInterval`/`setTimeout`-based animation. Use CSS or
  `requestAnimationFrame`.
- **Linking a content route from `/settings`.** Settings is configuration
  only (account, notifications, ghost mode, theme, diagnostics). Content
  features (`/timeline`, `/notes`, `/calendar`, `/bucket`, `/chat`,
  `/quiz`, `/repair`, `/pet`) must live under their hub (Today or
  Moments) and be reachable via that hub's `HubChips`. The `/settings`
  page must not contain anchors to those routes.
- **Orphan routes.** Any new authed route that is not in the §8 IA table,
  not surfaced as a `HubChips` chip on its parent hub, and not in
  `BottomNav.SECONDARY_PARENT` is unreachable from a cold app launch.
  This is a ship-blocker.
