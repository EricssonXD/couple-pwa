# DuoSync — UI Design Brief for Gemini

> Prompt this verbatim to Gemini (or any image/UI model) to generate
> mockups, screen flows, mood boards, or component sheets.

---

## 1. What the app is

**DuoSync (雙心同步)** is a private mobile PWA shared by exactly two
people in a romantic relationship. It is **not** a social network, not
a messaging app, not a "find my friends" tracker. It is a **passive
presence** companion: a tiny window into the other person's day that
makes you feel less alone without intruding on either of you.

The core insight: most couple apps are loud (notifications, chat
threads, status updates). DuoSync is **quiet**. You glance at it the
way you glance at a window — it reassures you, then gets out of the
way.

Tagline candidates:
- *"被動共在 — passive presence."*
- *"A window, not a feed."*
- *"Two heartbeats, one screen."*

## 2. Who it's for

- Couples in a relationship (long-distance OR cohabiting).
- Age 20–40, mobile-first, comfortable with PWAs.
- Bilingual: Traditional Chinese (zh-Hant, primary) and English (en).
- Privacy-conscious: they want the data to stay between the two of
  them, not feed an algorithm.

Tone of the product:
- Tender but not saccharine. Warm but not childish.
- Minimal text. Status communicated through soft motion, color, and
  gentle haptics rather than words.
- Never anxiety-inducing — no red dots, no "X unread", no streak-loss
  threats. (Streaks exist but are presented as gentle flames, not
  punishments.)

## 3. Aesthetic direction

Think:
- **Light theme**: soft cream + dusty rose + sage. Hand-rolled paper
  texture vibes, but rendered cleanly — no skeuomorphic noise.
- **Dark theme**: deep midnight blue + warm peach accents. Like a
  bedside lamp at 11pm. Avoid pure black + neon.
- **Typography**: a humanist sans (Inter / Plus Jakarta Sans) for UI;
  one hand-feel display face (e.g. a soft serif like Fraunces) for
  numerals + special moments (anniversary day count, distance bubble).
- **Iconography**: rounded, two-tone, breathable. No sharp corners.
  Heroicons "outline" style as a baseline, customized.
- **Motion**: spring physics, never linear. Things should feel
  *breathing*. The pulse bubble literally pulses (1bpm scale, 2s
  cycle). Transitions are 250–350ms, ease-out for entry, ease-in for
  exit.
- **Haptics**: every meaningful action has a soft tap (`navigator.vibrate(15)`).
  Heartbeat tap from partner = 2× 30ms vibration with 80ms gap.

Colors (start palette — Gemini may iterate):
| Role | Light | Dark |
|---|---|---|
| Background | `#faf6f1` cream | `#0e1424` midnight |
| Surface | `#ffffff` paper | `#1b2238` slate |
| Primary | `#e07a8f` dusty rose | `#f4b1a0` warm peach |
| Accent | `#9bb89f` sage | `#8fa9b8` mist blue |
| Distress | `#c44545` muted red | `#e88a8a` soft red |
| Ink | `#2a2030` warm black | `#f5ecd9` warm cream |

## 4. Layout & platform constraints

- **Mobile-first PWA**, full-screen, installable to home screen.
  Designs must work in `100dvh` with safe-area insets (notch + home
  indicator).
- Bottom navigation: 4 tabs maximum.
- One-thumb reachable. Primary actions in the bottom 1/3 of the
  screen.
- Tablet / desktop: center the mobile layout in a "phone frame" with a
  blurred ambient backdrop; do **not** spread it edge-to-edge.
- Stack: SvelteKit + Tailwind v4 + DaisyUI 5 (so any custom CSS should
  feel compatible — design tokens map to CSS variables).

## 5. Information architecture

Bottom nav (4 tabs):

1. **Pulse** (default) — the always-glanceable home
2. **Map** — shared map view
3. **Moments** — geo-moments + timeline
4. **You** — settings, couple page, sign-out

Top-bar (per page) is minimal: page name in small caps, a single
optional context icon on the right (e.g., ghost-mode toggle on Pulse).

## 6. Screen-by-screen brief

### 6.1 `/pulse` — the heart of the app
Goal: in a single glance, the user knows their partner is OK.

Components, top to bottom:
- **Anniversary Ribbon**: thin ribbon with "Day 423 · together since
  2024-01-08 · 77 days to anniversary 🎈" — soft, dismissible per day.
- **Distance Bubble** (the hero): a large, round, **breathing**
  element. Center text shows distance (e.g. "283 m" or "12.4 km" or
  "次元相隔 0 m" when at same place). Color encodes proximity bucket:
  - same place: warm gold
  - near (<1km): sage
  - city (<25km): rose
  - far (≥25km): mist blue
  - ghost mode: slate, with a small 👻 emoji
- **Partner avatar** floating top-right of the bubble; a small
  presence dot (online / away / offline).
- **Battery + last-seen** under the bubble, small text:
  `🔋 88% · 4m ago` with an icon if charging.
- **Mood weather**: small "today's weather" pictograph based on
  partner's mood log: ☀️ sunny / ⛅ partly cloudy / 🌧️ rainy / 🌙
  asleep. One-line caption ("she's having a sunny day").
- **Heartbeat Tap zone**: bottom of screen, full-width invisible hit
  area. Double-tap → soft expanding ring + 2× haptic + sends tap to
  partner. Tooltip first-time only: "double-tap to send a heartbeat".
- **Memory Resurface card** (occasional, ~1/week): a small card "去年
  今日 · One year ago today" with a thumbnail of an old moment.

### 6.2 `/map`
Goal: see both pins on one map at once.

- Leaflet/MapLibre, both partners' last-known location as soft
  pulsing dots with their avatar emoji.
- A line connecting them, labeled with distance.
- Bottom sheet (drag-up): toggle layers (places, recent path,
  geo-moments).
- "Center on us" button = fits both pins in viewport.
- Ghost mode: that partner's pin becomes a fuzzy blob with a 👻 icon
  and the distance reads "—".

### 6.3 `/moments` — list view
Goal: a feed of geo-moments either of you have dropped.

- Vertical timeline. Each card:
  - Author avatar + name ("Alice · 2h ago · near Tsim Sha Tsui")
  - Body (text up to 280 chars; optional image)
  - A tiny inline map preview (rounded rectangle) showing the drop
    location.
  - **Lock state**: if `unlocked_at` is null AND the viewer is not
    near, the card is blurred + says "Walk closer to read 🚶 ___m
    away".
  - Footer: a soft heart + comment-thread count (Phase 2).
- FAB bottom-right: + → `/moments/new`.

### 6.4 `/moments/new`
- Top: small map preview centered on current location, draggable pin
  (radius slider: 30m / 100m / 500m).
- Caption text area (placeholder: "what do you want her to find
  here?").
- Optional image picker.
- Optional expiry: "expires in 24h / 7d / never".
- Bottom: large primary button "Drop here ✨".

### 6.5 `/timeline` (folded into Moments tab)
- Year/month scrubber on the right edge.
- Mixed feed: moments, anniversaries, photos.
- "On this day" pills.

### 6.6 `/you` — settings
- Big avatar + display name + status emoji at top.
- Couple card: "Alice & Bob · 423 days · since 2024-01-08", tap →
  rename / set anniversary / unpair.
- Privacy: ghost mode toggle (with countdown picker), geo-fence
  privacy zones (list of "Home, Work, Therapist's office"), blur
  precision toggle.
- Notifications: per-event subscription chips (location, mood, taps,
  moments).
- Appearance: theme (auto / light / dark), language (中文 / EN).
- Audit log link.
- Sign out at the bottom.

### 6.7 `/onboarding` (3 steps)
1. Welcome screen with two breathing dots, "Let's set up your two-
   person space."
2. Profile: name, emoji, mood.
3. Pair: "Generate code" or "Enter partner's code". 6-char code,
   30-min expiry. After pairing, a celebratory bloom animation.

## 7. Components Gemini should design

Please produce:
- Bottom nav (4 tabs), light + dark.
- Distance Bubble in all 5 states (same / near / city / far / ghost).
- Pulse screen full-page, light + dark.
- Map screen full-page, light + dark.
- Moments list with one locked + one unlocked card.
- Moments composer.
- Onboarding pair-code screen.
- Heartbeat Tap interaction (3-frame: idle → tap → ripple).
- Memory Resurface card.
- Settings home (the You tab).
- A "ghost mode active" banner (so the partner knows their location
  is hidden).

## 8. Interaction primitives

- **Pull-to-refresh** on Pulse: not a spinner — a heart icon that
  expands as you pull, then pops + haptic on release.
- **Long-press SOS** (deferred but design it): hold the avatar 2s →
  ring fills → SOS sent. Tooltip on first install.
- **Skeleton everywhere**: never a spinner. Use shimmer placeholders
  shaped like the real content.
- **Optimistic UI**: posting a moment drops it instantly (slight
  opacity until server confirms).

## 9. Accessibility

- All color pairs ≥ WCAG AA contrast (4.5:1 for body, 3:1 for large).
- Distance Bubble must communicate state via shape + label too, not
  color alone (ghost = 👻 emoji + dotted ring; same place = gold ring
  with sparkle).
- Reduced-motion: pulse bubble becomes static, tap ripples shorten to
  120ms.
- All controls ≥ 44×44pt.

## 10. Things to AVOID

- Notification badges with red dots.
- "X is typing…" indicators.
- Anything resembling a public feed (no usernames, no @ mentions).
- Stalker-y precision (no "Alice arrived at home 2 minutes ago" — say
  "Alice is at home").
- Achievement gamification beyond the gentle Mood Streak flame.
- Aggressive empty states ("You haven't posted anything!").

## 11. Constraints from the codebase

- Must be implementable with **Tailwind v4 + DaisyUI 5** + `lucide-svelte`
  (or @iconify equivalent). No custom SVG sprite system.
- Theme switch happens via DaisyUI's `data-theme` attribute, so
  Gemini should design two themes named **`duosync-light`** and
  **`duosync-dark`**.
- Locale switch is instant (no reload), so any layout must survive
  text-length change between zh-Hant and English (≈ 1.4× expansion
  in EN).

## 12. Deliverable format

Please output:
1. A single mood board (1 image).
2. A 4-screen flow sheet (Pulse, Map, Moments list, Moments composer).
3. A token sheet (colors, type ramp, spacing scale, radii).
4. Component sheet for the items in §7.
5. One short rationale paragraph per artifact.
