# DuoSync — Shared Pet System

> Locked design pillars (from the Socratic gate, brainstorming skill):
> **Tamagotchi-lite** • **single species pet, picked at hatch, evolves through stages** •
> **decay enabled but never lethal** • **only mutual / mostly-mutual actions feed it** •
> **full-economy shop** (cosmetics + treats + room furniture + temporary buffs) •
> phased build with the *whole* spec written down up front.

---

## Goal

A shared pet that is the visual, emotional pay-off of the daily rituals
DuoSync already has. The couple together hatches it, names it, feeds it
with their everyday acts of presence (daily check-in reveal, mood logs,
quiz packs, bucket items, repair completions, anniversaries), spends
earned **Cozy Coins** in a small paper-sketched shop, and watches it grow
through three life stages. The pet has a mood / hunger that gently
decays — but it can never die, run away, or guilt either partner. It is
a *companion*, not a homework assignment.

This is the first DuoSync feature that is purely playful. Everything
else is a relationship ritual; the pet is a *reward layer* that sits on
top of those rituals and visualises "we showed up for each other".

---

## Core 30-second loop

```
1. ACTION — partner does something the app already values
            (reveal daily, log mood, finish a quiz, complete a bucket item…)
2. FEEDBACK — pet animation reacts on /pulse (small pet badge) or
              /pet (full habitat scene); a little floating "+N 🪙"
              (rendered as a hand-drawn coin SVG, not emoji)
3. REWARD — Cozy Coins added to the couple wallet, pet mood ticks up,
            XP toward next evolution stage accrues
4. REPEAT — next ritual, same pet, same wallet
```

The pet's role is to make the existing rituals **feel rewarding** without
turning them into a streak engine. There is no "you missed a day"
copy. Ever.

---

## 1. Game-design pillars (skill: game-design)

| Pillar | DuoSync expression |
|---|---|
| **Player motivation — Socializer** | Pet's growth is shared. Both partners' actions count; cosmetics live in a couple-shared wardrobe. There is no leaderboard. |
| **Reward schedule — Fixed + small variable** | Fixed per-action coin payouts (predictable, never feels rigged). Tiny variable bonus on "double-mutual" days (both partners did the same ritual same day). |
| **Progression — Power + Content** | XP toward life stages = power. New shop unlocks at each stage = content. |
| **Flow — gentle slope** | Stage 1 reachable in days, Stage 2 in weeks, Stage 3 in months. Never grindy. |
| **Anti-coercion (DuoSync rule, not a generic skill rule)** | Decay is *capped* at "a little sleepy / a little hungry". Pet never gets sick, never dies, never sends guilt-tripping copy. The /pet screen is opt-in; it is never the home screen. |

### Earning table (locked in this PR)

Per-action coin + XP grants. All have a **once-per-day cap per couple**
unless noted, so nothing is spammable. The "mutual?" column drives the
*shared_action_required* rule: solo actions earn ½, mutual actions earn full.

| Trigger | Coins (full) | XP | Mutual? | Cap |
|---|---|---|---|---|
| `daily_send` (you submitted today's daily) | 2 | 1 | ½ on solo | 1/day each partner |
| `daily_reveal` (both partners revealed) | 8 | 4 | full | 1/day per couple |
| `mood_log` (logged a mood on /pulse) | 1 | 1 | ½ on solo | 3/day per partner |
| `quiz_complete` (both finalised a quiz pack) | 12 | 8 | full | 1 per pack ever |
| `bucket_complete` (item marked done) | 6 | 3 | full | unlimited but de-duped per item |
| `repair_complete` (session marked resolved) | 10 | 5 | full | 1/day per couple |
| `anniversary` (relationship anniversary day) | 25 | 12 | full | 1/year |

> All numbers are *initial guesses*. They are constants in
> `src/lib/pet.constants.ts` so a balance pass can tweak them without
> touching server logic. Tests assert the constants, not literals.

### Life stages

| Stage | XP threshold | Visual change |
|---|---|---|
| **Egg** | 0 | Speckled paper-textured egg with a small heartbeat anim. |
| **Baby** | 50 XP | Hatchling form of chosen species. Slightly clumsy idle. |
| **Grown** | 250 XP | Full form. Unlocks "expression" slot in the wardrobe. |

Stages are one-way; once Grown, the pet stays Grown. No prestige reset.

### Species (picked at hatch, immutable)

Hand-drawn paper-sketch style to match the rest of the brand
(`MoodFace` / `PartnerAvatar` precedent). Four options:

1. **Fox** — orange, curious, idle = tail-flick.
2. **Cat** — cream, sleepy, idle = blink + slow tail.
3. **Bird** — slate, cheerful, idle = head-tilt.
4. **Capybara** — warm taupe, chill, idle = a single eye-half-close.

Each species has 3 stage sprites × ≥3 mood frames = 9 SVG frames minimum.
Living in `src/lib/assets/pet/<species>/<stage>-<mood>.svg`.

### Mood / hunger decay (Tamagotchi-lite, never lethal)

- Two stats, each `int 0..100`, stored on `pet`:
  - `mood` — drops when neither partner does *any* feeding action for a day
  - `hunger` — inverse of fullness; rises slowly between treats
- Decay rate: **−5 mood/day, +5 hunger/day** of inactivity.
- **Floor: 20 mood, ceiling: 80 hunger.** The pet can look a bit
  glum/peckish but never "ill". No red badges, no shake animations, no
  "your pet misses you" push notifications.
- A mutual reveal *or* a treat from the shop **resets hunger to 0 and
  bumps mood +20** (capped at 100).
- Decay is computed lazily on read (no cron): we store
  `mood_last_updated_at` + `hunger_last_updated_at` and project forward
  when the API is hit. This keeps Cloudflare Workers stateless.

---

## 2. Data model (skill: database-design)

All tables follow the existing DuoSync conventions in
`src/lib/server/db/app.schema.ts`:

- UUID PKs with `defaultRandom()`
- `coupleId uuid` FK to `couple.id` with `onDelete: 'cascade'`
- Composite indexes prefixed `<table>_couple_<col>_idx`
- Timestamps as `timestamp({ withTimezone: true })`
- The Drizzle backend bypasses RLS — all writes derive coupleId
  from `locals.couple`, never the request body.

```ts
// src/lib/server/db/app.schema.ts — appended near the bottom.

export const pet = pgTable(
  'pet',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    coupleId: uuid('couple_id')
      .notNull()
      .references(() => couple.id, { onDelete: 'cascade' }),
    species: text('species').notNull(),       // 'fox' | 'cat' | 'bird' | 'capybara'
    name: text('name').notNull(),             // 24-char cap
    stage: text('stage').notNull().default('egg'), // 'egg' | 'baby' | 'grown'
    xp: integer('xp').notNull().default(0),
    mood: integer('mood').notNull().default(80),
    hunger: integer('hunger').notNull().default(20),
    moodUpdatedAt: timestamp('mood_updated_at', { withTimezone: true })
      .notNull().defaultNow(),
    hungerUpdatedAt: timestamp('hunger_updated_at', { withTimezone: true })
      .notNull().defaultNow(),
    hatchedAt: timestamp('hatched_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pet_couple_uq').on(t.coupleId), // one pet per couple
    check('pet_species_chk', sql`${t.species} in ('fox','cat','bird','capybara')`),
    check('pet_stage_chk', sql`${t.stage} in ('egg','baby','grown')`),
    check('pet_xp_chk', sql`${t.xp} >= 0`),
    check('pet_mood_chk', sql`${t.mood} between 0 and 100`),
    check('pet_hunger_chk', sql`${t.hunger} between 0 and 100`),
  ]
);

export const petWallet = pgTable(
  'pet_wallet',
  {
    coupleId: uuid('couple_id')
      .primaryKey()
      .references(() => couple.id, { onDelete: 'cascade' }),
    coins: integer('coins').notNull().default(0),
    lifetimeEarned: integer('lifetime_earned').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('pet_wallet_coins_chk', sql`${t.coins} >= 0`)]
);

// Append-only ledger of every coin/XP grant + spend.
// Used to (a) de-dupe per-action grants, (b) power the /pet activity
// feed, (c) make balance audits trivial.
export const petLedger = pgTable(
  'pet_ledger',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    coupleId: uuid('couple_id')
      .notNull()
      .references(() => couple.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => authUsers.id, { onDelete: 'set null' }),
    kind: text('kind').notNull(), // 'earn' | 'spend' | 'adjust'
    source: text('source').notNull(), // e.g. 'daily_reveal' / 'shop:hat_paper' / 'admin_grant'
    coinsDelta: integer('coins_delta').notNull(),
    xpDelta: integer('xp_delta').notNull().default(0),
    // Dedup key, eg 'daily_reveal:2024-11-04' or 'bucket:<itemId>' — UNIQUE per couple.
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('pet_ledger_dedupe_uq')
      .on(t.coupleId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index('pet_ledger_couple_created_idx').on(t.coupleId, t.createdAt.desc()),
    check('pet_ledger_kind_chk', sql`${t.kind} in ('earn','spend','adjust')`),
  ]
);

// Shop catalogue — seeded data, not user-managed. Versioned via
// migrations so prices can be re-balanced without code edits.
export const petShopItem = pgTable(
  'pet_shop_item',
  {
    id: text('id').primaryKey(),    // slug, eg 'hat_paper_crown'
    kind: text('kind').notNull(),   // 'cosmetic' | 'treat' | 'furniture' | 'buff'
    slot: text('slot'),             // cosmetic slot: 'hat' | 'scarf' | 'expression' | null
    name: text('name').notNull(),   // i18n key, eg 'shop_item_hat_paper_crown_name'
    description: text('description').notNull(), // i18n key
    priceCoins: integer('price_coins').notNull(),
    minStage: text('min_stage').notNull().default('egg'), // 'egg' | 'baby' | 'grown'
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    check('pet_shop_item_kind_chk',
      sql`${t.kind} in ('cosmetic','treat','furniture','buff')`),
  ]
);

// Per-couple inventory. Cosmetics + furniture are persistent; treats
// + buffs are consumable (deleted on use).
export const petInventory = pgTable(
  'pet_inventory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    coupleId: uuid('couple_id')
      .notNull()
      .references(() => couple.id, { onDelete: 'cascade' }),
    itemId: text('item_id').notNull().references(() => petShopItem.id),
    qty: integer('qty').notNull().default(1),
    equipped: boolean('equipped').notNull().default(false),
    acquiredAt: timestamp('acquired_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('pet_inventory_couple_idx').on(t.coupleId),
    uniqueIndex('pet_inventory_couple_item_uq').on(t.coupleId, t.itemId),
    check('pet_inventory_qty_chk', sql`${t.qty} >= 0`),
  ]
);

// Optional later: petRoom (furniture placement). Not in v1.
```

### Why a ledger + dedupe key?

Two reasons:

1. **Idempotency.** All earn paths funnel through `awardForEvent(coupleId, source, dedupeKey)`. The unique index on `(coupleId, dedupeKey)` makes double-fire (eg a retried POST) a no-op at the DB level — no race conditions, no double-pay.
2. **Auditability.** The /pet activity strip and any future debugging just `SELECT * FROM pet_ledger WHERE couple_id = ? ORDER BY created_at DESC LIMIT 20`. No reconstruction from event tables.

---

## 3. Server architecture

New module: `src/lib/server/services/pet.ts`. Mirrors `bucketList.ts` and
`quiz.ts` conventions:

```ts
// Public API.
export async function getPetState(coupleId): Promise<PetState | null>
export async function hatchPet(coupleId, species, name): Promise<PetState>
export async function renamePet(coupleId, name): Promise<PetState>

// Idempotent: same (coupleId, dedupeKey) → no-op + returns the original.
export async function awardForEvent(
  coupleId,
  userId,
  source,           // 'daily_reveal' | …
  dedupeKey,
  opts?: { mutual?: boolean }
): Promise<{ coinsDelta: number; xpDelta: number; ledgerId: string }>

export async function listShopItems(stage): Promise<PetShopItem[]>
export async function buyItem(coupleId, userId, itemId): Promise<PetInventoryEntry>
export async function equipCosmetic(coupleId, itemId, equipped): Promise<void>
export async function consumeTreat(coupleId, userId, itemId): Promise<PetState>
```

**Lazy decay** is implemented inside `getPetState`:

```ts
const daysSince = (now - moodUpdatedAt) / 86_400_000;
const projectedMood   = clamp(stored.mood   - 5 * daysSince, 20, 100);
const projectedHunger = clamp(stored.hunger + 5 * daysSince,  0, 80);
// Persist only when the page actually triggers a write
// (eg awardForEvent, buyItem, consumeTreat). Reads stay read-only.
```

Constants live in `src/lib/pet.constants.ts` (parallel to
`bucketList.constants.ts`, `quiz.constants.ts`). Same module is
importable client-side for UI thresholds.

### Wiring earn events into existing services

Each existing service gets one additional line — a fire-and-forget
`awardForEvent` after the existing happy path. None of the existing
service contracts change.

| Service | Hook point | dedupeKey shape |
|---|---|---|
| `daily.ts` — `submitDailyAnswer` | after row insert | `daily_send:<userId>:<YYYY-MM-DD>` |
| `daily.ts` — `revealDaily` | after both rows present | `daily_reveal:<questionId>` |
| `mood.ts` — `setMood` | after row insert | `mood_log:<userId>:<YYYY-MM-DDTHH>` (hour-bucket → 3/day max) |
| `quiz.ts` — `finaliseRun` | after both partners locked | `quiz_complete:<runId>` |
| `bucketList.ts` — `markDone` | after `done_at` set | `bucket_complete:<itemId>` |
| `repair.ts` — `markResolved` | after status flip | `repair_complete:<sessionId>` |
| anniversary | called from a cheap layout-load check | `anniversary:<YYYY>` |

`awardForEvent` returns `{ coinsDelta: 0, xpDelta: 0 }` on dedupe-hit so
callers can ignore it; UI doesn't surface a toast in that case.

### Failure mode

`awardForEvent` is wrapped in a try/catch so a pet-side failure
**never** breaks a relationship ritual. A failed award logs to
`audit_log` and silently no-ops.

---

## 4. API routes

All under `src/routes/api/pet/`. JSON in/out, auth via `event.locals.user`
+ `event.locals.couple` (same hooks as the rest of the app).

| Method · path | Body | Returns |
|---|---|---|
| `GET    /api/pet` | — | full `PetState` + wallet + equipped cosmetics |
| `POST   /api/pet/hatch` | `{ species, name }` | `PetState` (only valid when no pet exists) |
| `PATCH  /api/pet` | `{ name }` | `PetState` |
| `GET    /api/pet/shop` | — | list of `PetShopItem` filtered by current stage + `enabled` |
| `GET    /api/pet/inventory` | — | list of owned items |
| `POST   /api/pet/buy` | `{ itemId }` | `{ wallet, inventoryEntry }` |
| `POST   /api/pet/equip` | `{ itemId, equipped }` | `PetState` (cosmetic only) |
| `POST   /api/pet/treat` | `{ itemId }` | `PetState` (decrements qty) |
| `GET    /api/pet/ledger?limit=20` | — | last N ledger rows for /pet activity strip |

Validation rules:

- `species` ∈ {fox,cat,bird,capybara}; `name` 1–24 chars, no newlines.
- `buy` returns **402 Payment Required** if coins < price.
- `equip` returns **409 Conflict** if another item is already in that slot
  (server auto-unequips on the *next* equip; explicit unequip via
  `equipped: false`).
- `treat` returns **404** if qty = 0.

---

## 5. Client UI

### New route: `/pet`

- Full-screen habitat scene (paper background, no glassmorphism).
- Pet rendered in the centre at current stage + mood frame.
- Floating coin counter top-right (hand-drawn paper coin SVG, **not the 🪙 emoji**).
- Three pill tabs at the bottom (uses the existing `Tabs` primitive):
  1. **Pet** — name, stage, mood/hunger bars (sketchy SVG bars), latest 5 ledger entries.
  2. **Shop** — grid of shop items, locked items dimmed, price shown next to coin SVG.
  3. **Wardrobe** — owned cosmetics, equip toggle per slot.
- First visit (no pet row) shows the **hatch flow**:
  1. Species picker — 4 `ChoiceChip`s in a 2×2 grid.
  2. Name input — `InputField`, 24 char cap.
  3. `PillButton` "Hatch" → POST `/api/pet/hatch` → confetti-of-sketches anim, then habitat.

### Cross-route surfacings

- `/pulse` — small pet badge in the header strip, next to the partner avatars. Tappable, links to `/pet`. Shows current mood frame. **Not** a notification dot — it's just present.
- After any qualifying event (`daily_reveal`, `quiz_complete`, etc.) the existing success toast/route gets a *single* extra line:
  `+8 coins · {petName} is happy.` (Notice primitive, tone="success".)
- Settings → Diagnostics: new link "Pet ledger" → read-only view of all ledger rows for the couple (transparency + debugging).

### Components / primitives to add

| Component | Purpose | Lives at |
|---|---|---|
| `PetSprite.svelte` | Renders the right species+stage+mood SVG with breathing anim. | `src/lib/components/pet/PetSprite.svelte` |
| `CoinIcon.svelte` | Hand-drawn coin SVG (single source of truth, never emoji). | `src/lib/components/pet/CoinIcon.svelte` |
| `MoodHungerBars.svelte` | Two sketchy bars with subtle wiggle (respects `prefers-reduced-motion`). | `src/lib/components/pet/MoodHungerBars.svelte` |
| `ShopCard.svelte` | One shop tile (icon + name + price + locked overlay). | `src/lib/components/pet/ShopCard.svelte` |
| `HatchFlow.svelte` | Species + name + hatch CTA wizard. | `src/lib/components/pet/HatchFlow.svelte` |

All re-use existing primitives (`Card`, `PillButton`, `Notice`,
`Spinner`, `ChoiceChip`, `InputField`, `Tabs`). No new daisyUI classes.

### Motion

- Idle breathing: 4 s `transform: scaleY(1) → 1.02 → 1` SVG transform.
- Coin earn: floating "+N" rises 24 px and fades over 600 ms.
- Stage-up: brief paper-fold anim (the previous stage SVG dissolves, the
  new one fades in over 800 ms). One-time per stage.
- All anims wrapped in the global `prefers-reduced-motion` reset
  (`src/routes/layout.css:182-190`).

### i18n

All copy goes to `messages/en.json` + `messages/zh-hant.json`. Key
prefix `pet_*` and `shop_item_<id>_name` / `shop_item_<id>_description`.
Approximate count for v1: ~60 new keys (shop seed of 12 items × 2
strings = 24, plus UI labels and ledger sources).

---

## 6. Shop seed (v1)

12 items, balanced so the first cosmetic is reachable after ~one week
of casual play and the most expensive furniture takes ~a month.

| Slug | Kind | Slot | Stage | Price | Notes |
|---|---|---|---|---|---|
| `hat_paper_crown` | cosmetic | hat | baby | 30 | Starter cosmetic |
| `hat_beanie` | cosmetic | hat | baby | 60 | |
| `scarf_red` | cosmetic | scarf | baby | 50 | |
| `scarf_dotted` | cosmetic | scarf | grown | 90 | |
| `expr_sleepy` | cosmetic | expression | grown | 80 | Eyelid overlay |
| `treat_strawberry` | treat | — | egg | 10 | +20 mood, −20 hunger |
| `treat_dumpling` | treat | — | baby | 20 | +30 mood, −30 hunger |
| `treat_cake` | treat | — | grown | 35 | +50 mood, −40 hunger |
| `furn_rug` | furniture | — | baby | 80 | Background tile |
| `furn_window` | furniture | — | grown | 140 | Background tile |
| `buff_doublecoin` | buff | — | baby | 50 | Next 24 h: ×1.5 coin earns |
| `buff_xpboost` | buff | — | grown | 70 | Next 24 h: ×1.5 XP earns |

Buffs are stored on `petInventory` with `qty` and a separate
`active_until` timestamp on a *future* `petBuff` table — punted to
Phase 5 because v1 ships without buffs active (they're sellable but
the multiplier is wired in Phase 5).

---

## 7. Phased rollout

Each phase is a stand-alone PR. Each phase ends with the same tests
green: `bun run check && bun run lint && bun run build && bun run test`.

### Phase 1 — Schema + ledger + state read

- [ ] **P1.1** Append all 5 tables to `app.schema.ts` + run `bun run db:generate`.
- [ ] **P1.2** Seed `pet_shop_item` rows via a SQL migration (no admin UI).
- [ ] **P1.3** Build `src/lib/server/services/pet.ts` with `getPetState`, `hatchPet`, `renamePet`, lazy decay.
- [ ] **P1.4** Build `GET /api/pet`, `POST /api/pet/hatch`, `PATCH /api/pet`.
- [ ] **P1.5** Unit tests for decay clamps, hatch idempotency, name validation.
- [ ] **Verify:** `curl -X POST /api/pet/hatch -d '{"species":"fox","name":"Mochi"}'` then `GET /api/pet` returns the egg state.

### Phase 2 — Earn pipeline

- [ ] **P2.1** Implement `awardForEvent` with dedupe-key idempotency.
- [ ] **P2.2** Wire all 7 earn hooks (`daily_send`, `daily_reveal`, `mood_log`, `quiz_complete`, `bucket_complete`, `repair_complete`, `anniversary`).
- [ ] **P2.3** Define `src/lib/pet.constants.ts` with the earning table.
- [ ] **P2.4** Tests: idempotency (same dedupe-key twice → 1 ledger row, 1 grant), mutual/solo halving, daily cap.
- [ ] **Verify:** Sign in as both partners, both reveal daily, wallet shows +8 once.

### Phase 3 — `/pet` route + habitat UI

- [ ] **P3.1** Stage 1 art pass: 4 species × 3 stages × 3 mood frames = 36 SVGs (paper-sketch style).
- [ ] **P3.2** `PetSprite`, `CoinIcon`, `MoodHungerBars`, `HatchFlow` components.
- [ ] **P3.3** `/pet/+page.svelte` + `/pet/+page.server.ts` (load uses `getPetState`).
- [ ] **P3.4** `/pulse` header gets the small pet badge.
- [ ] **P3.5** Storybook stories for each new component.
- [ ] **Verify:** Hatch flow → habitat renders → idle breathing animates (or stills under `prefers-reduced-motion`).

### Phase 4 — Shop + inventory + treats

- [ ] **P4.1** `listShopItems`, `buyItem`, `consumeTreat`, `equipCosmetic` services.
- [ ] **P4.2** Shop, inventory, equip endpoints.
- [ ] **P4.3** Shop tab + Wardrobe tab in `/pet`.
- [ ] **P4.4** Treat consumption animation (mood bar fills with bounce).
- [ ] **P4.5** Tests: 402 on insufficient coins, slot collision auto-unequip, treat qty decrement.
- [ ] **Verify:** Buy `treat_strawberry` with 10 coins, consume it, pet mood jumps +20.

### Phase 5 — Buffs + activity strip + ledger view

- [ ] **P5.1** Add `petBuff` table + `active_until` semantics in `awardForEvent`.
- [ ] **P5.2** `GET /api/pet/ledger` + activity strip in /pet "Pet" tab.
- [ ] **P5.3** Settings → Diagnostics → "Pet ledger" debug link.
- [ ] **P5.4** Stage-up paper-fold animation.
- [ ] **Verify:** Activate `buff_doublecoin`, complete a quiz, ledger row shows 18 coins (= 12 × 1.5) on the audit page.

### Phase 6 — Polish

- [ ] **P6.1** zh-hant pass on all ~60 new keys.
- [ ] **P6.2** Playwright e2e: hatch → earn → buy → equip.
- [ ] **P6.3** Storybook coverage for happy / mid-mood / low-mood states.
- [ ] **P6.4** `audit_empty`-style empty-state copy for "no pet yet", "shop locked at this stage", "no items owned".
- [ ] **P6.5** README "Pet system" subsection + add `/pet` to the routes list.

---

## 8. Done when

- [ ] `GET /api/pet` returns a hatched pet for any couple that hit `/pet` once.
- [ ] All 7 earn sources fire exactly once per dedupe-key under retry.
- [ ] Wallet, inventory, equip, treat all work end-to-end through the UI.
- [ ] Pet visibly evolves egg → baby → grown as XP accrues; never regresses.
- [ ] No emoji used anywhere in the new feature; everything is SVG or text.
- [ ] No new daisyUI residue (raw `btn-*` classes); only the existing primitives.
- [ ] All copy in en + zh-hant; no hard-coded English.
- [ ] `bun run test` (unit + Playwright) green.
- [ ] Bundle delta on the `/pet` chunk is < 80 KB gzipped.
- [ ] Decay never produces values outside the documented 20 / 80 floors.

---

## 9. Open questions (defer to implementation)

1. **Where does name profanity get filtered?** Probably nowhere — the
   pet name is only visible to the partner. Keep it loose.
2. **Push notifications?** Punted. The `purpose = tamagotchi-lite` choice
   said "decay yes, never lethal". Pushing "your pet is hungry" violates
   the anti-coercion rule. The pet is *visited*, not *summoned*.
3. **Pet death / rebirth?** Explicit non-goal. Confirmed by the *decay
   capped at 20 mood / 80 hunger* spec.
4. **Cross-couple visibility?** None. The pet is private to one couple,
   exactly like every other DuoSync data type.
5. **Re-balancing strategy?** All numbers live in
   `src/lib/pet.constants.ts`; shop prices live in the
   `pet_shop_item` table. A balance pass = a migration + a constants
   bump + a regression test on the new floor values.

---

## 10. Skills consulted

- `brainstorming/SKILL.md` — Socratic gate enforced before writing this plan.
- `game-development/game-design/SKILL.md` — core-loop, motivation, reward schedules, anti-patterns.
- `database-design/SKILL.md` — schema + indexing decisions; chose to mirror the existing Drizzle/Postgres conventions rather than re-derive.
- `plan-writing/SKILL.md` — short, specific tasks, verification per phase, file lives in project root as `pet-system.md`.
- `frontend-design/SKILL.md` — primitives reuse, no emoji, sketch aesthetic, motion + reduced-motion compliance.
- `i18n-localization/SKILL.md` — new strings via Paraglide keys in both locales, no hard-coded text.
