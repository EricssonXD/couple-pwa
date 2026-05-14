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

## Pitfalls considered (research → mitigation)

These were surfaced by reviewing post-mortems of Finch, Habitica,
Tamagotchi-style apps, couple-app gamification literature, and the
specific edge-runtime constraints of our stack. Each pitfall lists the
mitigation that is *baked into this plan*.

| # | Pitfall (citation) | Mitigation in this plan |
|---|---|---|
| **G1** | **Punitive decay turns wellness into anxiety** — Finch and Habitica users report stress, shame, and avoidance when missed days visibly hurt the avatar. ([UX Design — Virtual pet apps and their emotional toll](https://uxdesign.cc/virtual-pet-apps-and-their-emotional-toll-8c06c5f9e1c), [r/habitica guilt thread](https://www.reddit.com/r/habitica/comments/8vu2c5/anyone_else_get_really_guilty_about/)) | Decay is **floored at mood ≥ 20, hunger ≤ 80**; never sick, never dead, no red badges, no shake animations, **no push notifications about pet state** (see N1). Empty/low-mood copy is warm ("a little sleepy") not punitive. |
| **G2** | **Streak engines drive all-or-nothing thinking and churn** ([web.dev — habit streaks critique](https://web.dev/articles/habit-streaks)) | We grant **per-event coins**, never per-streak. The earning table has zero "consecutive day" bonuses. The `daily_send` cap is per-day, not per-streak. |
| **C1** | **Asymmetric engagement: shared progress collapses when one partner drops out** ([Paired science blog](https://paired.com/articles), and general gamification-failure pattern). Score-keeping is also a *known* indicator of relationship distress (Gottman Institute — "scorekeeping" as a Four-Horsemen-adjacent contempt pattern). | (a) **Solo actions earn ½, never zero** — the present partner can keep the pet alive. (b) **No partner-vs-partner counters anywhere** in the UI; `pet_ledger.userId` is server-side audit only, never surfaced. (c) **Floors do the protective work, not pause logic** — decay continues regardless of `couple.status` because the 20-mood / 80-hunger floors *already* guarantee the pet never deteriorates beyond "a little sleepy" (see *Warm-decay copy matrix* under §1). Pausing decay would be detectable post-reconciliation and surface "your partner caused this" inferences — exactly the scorekeeping anti-pattern. |
| **C2** | **Forcing both partners to act for any reward feels coercive** to the absent partner and frustrating for the present one | Every earn source has a **solo half-credit fallback** except the truly mutual ones (`daily_reveal`, `quiz_complete`, `repair_complete`, `anniversary` — all of which are *intrinsically* mutual: they cannot fire without both partners). |
| **I1** | **At-least-once handlers + naive INSERT race-condition** under concurrent writes ([Cloudflare Workers + Postgres dedupe pattern](https://developers.cloudflare.com/workers/databases/), [Postgres ON CONFLICT idempotency](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT)) | All earn paths funnel through **one** function (`awardForEvent`) that uses `INSERT ... ON CONFLICT (couple_id, dedupe_key) DO NOTHING RETURNING *`. The dedupe row IS the work proof; the wallet/XP update happens in the same transaction (see *Concurrency model*). |
| **I2** | **Two CF Workers compute decay from the same row in parallel → lost update** ([CockroachDB — lost update anomaly](https://www.cockroachlabs.com/docs/stable/transactions.html), classic Tamagotchi-style stat race) | Add a `version int` column to `pet`; every write does `UPDATE pet SET … , version = version + 1 WHERE id = ? AND version = ?` and **retries up to 3× on miss**. Reads are still lazy & lock-free. |
| **D1** | **Client clock drives decay → easy to cheat / inconsistent** | Decay is computed **server-side** using `now()` in Postgres. Client never submits timestamps. Lazy projection is read-only on `getPetState`; the next *write* (award/buy/treat) persists the decayed values. |
| **D2** | **Lazy decay never persists if the user never visits** → stale-but-correct stays stale forever; harmless but means analytics on stored mood are misleading. | Acceptable. Document it. Never run a cron — that defeats the point of stateless edge compute. |
| **P1** | **postgres-js `max: 1` per request × bursty earn-events → CF Worker pool exhaustion** at the Supabase pooler ([Supabase pgbouncer guidance](https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooling)) | Earn hooks **piggyback the request's existing AsyncLocalStorage bundle** — no new connection. We must **never** call `awardForEvent` from `event.waitUntil` because the bundle is closed by then; if we want fire-and-forget we run it before `resolve(event)` returns. Documented in P2.1. |
| **P2** | **`db:generate` introspection on a manual-SQL repo will produce a phantom diff** — this repo's migrations live in `drizzle/manual/` and `drizzle.config.ts` only ignores PostGIS / auth schemas. | We **do not** run `bun run db:generate`. New tables are added via a hand-written `drizzle/manual/0022_pet.sql` migration applied with the existing `db:migrate` flow, and the Drizzle table objects are appended to `app.schema.ts` purely so the typed query builder works. (P1.1 rewritten accordingly.) |
| **S1** | **Seed data drift** — if shop prices change in code, an existing prod row keeps the old price. Migrations re-running is also dangerous. | Seed via `INSERT … ON CONFLICT (id) DO UPDATE SET …` in a dedicated migration. New balance passes ship a *new* migration, never edit an old one. The `enabled` flag lets us retire items without deleting ledger references. |
| **A1** | **36 inline SVGs (4 species × 3 stages × 3 moods) blow the bundle** — even at 800 B each that's ~28 KB raw / ~6 KB gzipped ([web.dev — SVG optimization](https://web.dev/articles/optimize-svg)). Acceptable but per-route. | Lazy-load species sprites **only on `/pet`** via dynamic `import()`; `/pulse` badge uses one tiny shared sprite (current species + current stage + current mood ≈ 1 SVG ~1 KB). Run all assets through SVGO in build (already done). |
| **R1** | **Realtime sync between partners adds a channel-message per earn** — at scale that's non-trivial Supabase Realtime quota for cosmetic value. | **v1 ships a single `pet_state_changed` snapshot broadcast** debounced server-side at 2 s per couple. Bounded by earn rate (≤ 7 writes/day/couple typical). Two subscribers per couple → ≤ 14 messages/day/couple — three orders of magnitude under the Free tier 2 M/month quota even at 100 k couples ([Supabase Realtime pricing](https://supabase.com/docs/guides/realtime/pricing) — 2 M msg/mo Free, 5 M Pro, $2.50/M overage; counted as 1 send + 1 per receiver, so a broadcast to 2 partners = 3 messages). Decay is **never** broadcast — clients project it locally from `(stored_value, updated_at, now())` so partners always agree without traffic (see *Real-time sync* §). |
| **N1** | **"Your pet is hungry" pushes are textbook obligation-engagement** — exactly the anti-pattern Finch is criticised for. | Explicit non-goal. The pet is never the subject of a push. Codified in the `pet_*` push-kind allow-list (none). |

---

## Core 30-second loop

```
1. ACTION — partner does something the app already values
            (reveal daily, log mood, finish a quiz, complete a bucket item…)
2. FEEDBACK — pet animation reacts on /pulse (small pet badge) or
              /pet (full habitat scene); a little floating "+N coin"
              (rendered as a hand-drawn coin SVG, NEVER an emoji)
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
| **Anti-coercion (DuoSync rule)** | Decay is *capped*. Pet never gets sick, dies, or sends guilt copy. The /pet screen is opt-in; never the home screen. **Floors do the protective work** — decay continues regardless of `couple.status`, but the 20-mood / 80-hunger floors guarantee the worst visible state is "a little sleepy". Pause-on-paused was rejected (would leak partner-status as scorekeeping signal — see C1). |

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
Living in `src/lib/assets/pet/<species>/<stage>-<mood>.svg`. **Loaded
only on `/pet` via dynamic `import()`** so `/pulse` doesn't pay the
bundle cost (A1).

### Mood / hunger decay (Tamagotchi-lite, never lethal)

- Two stats, each `int 0..100`, stored on `pet`:
  - `mood` — drops when neither partner does *any* feeding action for a day
  - `hunger` — inverse of fullness; rises slowly between treats
- Decay rate: **−5 mood/day, +5 hunger/day** of inactivity.
- **Floor: 20 mood, ceiling: 80 hunger.** The pet can look a bit
  glum/peckish but never "ill". No red badges, no shake animations, no
  "your pet misses you" push notifications. (G1, N1)
- A mutual reveal *or* a treat from the shop **resets hunger to 0 and
  bumps mood +20** (capped at 100).
- Decay is computed **lazily, server-side** using Postgres `now()`. We
  store `mood_updated_at` + `hunger_updated_at` and project forward
  when the API is hit. **Reads do not write back**; the next *write*
  path (`awardForEvent`, `buyItem`, `consumeTreat`) persists the
  projected values along with its own change. (D1, D2)
- **Decay continues regardless of `couple.status`.** Pausing decay on
  paused/broken couples was rejected: the floors already cap the worst
  visible state at "sleepy", and any pause logic would surface as a
  detectable "your partner caused this" inference (C1 scorekeeping
  anti-pattern). Long-absence wording lives in the *Warm-decay copy
  matrix* below.

### Warm-decay copy matrix (4 states)

The pet has exactly four visible states; each maps to one species-agnostic
adjective + one habitat hint. **No state ever blames the user or the
partner.** ([Finch UX critique](https://uxdesign.cc/virtual-pet-apps-and-their-emotional-toll-8c06c5f9e1c) —
guilt-tone copy is the #1 driver of churn in wellness pets.)

| State | Trigger | Sprite frame | Copy (en) | NEVER show |
|---|---|---|---|---|
| **fine** | mood ≥ 70 ∧ hunger ≤ 30 | `*-happy.svg` | `pet_state_fine` → "{name} is pottering about." | — |
| **peckish** | hunger 30–60 | `*-neutral.svg` | `pet_state_peckish` → "{name} fancies a snack." | "hungry", "starving", "needs food" |
| **sleepy** | mood 30–60 ∧ hunger ≤ 60 | `*-neutral.svg` | `pet_state_sleepy` → "{name} is feeling a bit quiet today." | "sad", "lonely", "misses you", "missed you" |
| **floor** | mood ≤ 30 ∨ hunger ≥ 60 (clamped at 20/80) | `*-resting.svg` | `pet_state_resting` → "{name} is having a slow day. Say hi when you're around." | "ill", "sick", "dying", "neglected", any guilt phrasing |

**Long-absence return (90+ days):** when `now() - max(mood_updated_at, hunger_updated_at) > 90 days`,
the **first** `/pet` view after return shows a one-time `Notice` (not a
modal, not a toast):

> "Welcome back. {name} kept the lights on. Want to say hi?" — CTA: a
> single treat-from-the-jar button (free, server-granted via the
> `welcome_back` ledger source, no coin cost). Dedupe key:
> `welcome_back:<userId>:<YYYY-Q>` (one per quarter per partner, max).

This pattern follows Neko Atsume / Finch return-flows: invite, never
indict. Sources: [virtual-pet return-UX guidance](https://uxdesign.cc/virtual-pet-apps-and-their-emotional-toll-8c06c5f9e1c),
[habit-streak critique](https://web.dev/articles/habit-streaks).

### Earn-curve sanity check

Sustained shared earn (typical engaged couple, computed in
`/scripts/economy.mjs` — to add in P1):

```
daily_reveal       8 / day  (1× couple-wide)
mood_log (×2)      4 / day  (1 each, capped 1/hour)
quiz_complete    ~0.9/ day  (≈ once / week)
bucket_complete  ~0.4/ day  (≈ once / 30 days)
repair_complete  ~0.3/ day  (≈ once / 30 days)
                 ─────────
                 ~13.6 coins / day (couple-pooled)
```

Shop seed (12 items, prices 30–400, total 1 950 coins):

| Milestone | Days | Coins |
|---|---|---|
| First cosmetic (`hat_paper_crown`, 30 c) | ~2.2 days | 30 |
| Median item (~140 c) | ~10 days | 140 |
| Whole shop cleared | ~143 days (≈ 5 months) | 1 950 |
| Week-1 budget | 7 days | ~95 c (covers 4/12 items) |
| Month-1 budget | 30 days | ~408 c (covers 12/12 *individually*) |

This shape matches the cosmetic-economy heuristics from F2P post-mortems
(Pocket Camp / Hay Day): first cosmetic in <1 week (immediate proof of
agency), aspirational tail at ~5 months (sustains long-term loop without
gating). No FOMO, no limited-time items, no premium currency — DuoSync
has zero monetisation in v1.

### Anti-coercion when one partner stops

- The pet keeps existing forever; the active partner can still feed it via
  solo half-credits and treats, and the floor (mood ≥ 20) means it
  cannot deteriorate visually below "a little sleepy".
- The UI **never** shows "your partner hasn't…" copy or per-partner
  coin attribution. The ledger keeps `userId` for audit, but the
  in-app `/pet` activity strip renders only the *source* (e.g. "daily
  reveal · +8") and never which partner triggered the row.
- `couple.status == 'broken'` does **not** lock pet writes — both
  partners can still hatch / feed / equip alone. The solo-half-credit
  path keeps the loop alive without requiring partner action.

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

Migrations are **manual SQL** in `drizzle/manual/` (this repo's
convention; `drizzle-kit generate` is not used because the manual
migrations contain RLS, triggers, and seed data that drizzle-kit
introspection would clobber). The next migration number is **0022**.

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
    // I2: optimistic concurrency. Every write asserts version match
    // and bumps it; mismatched writes retry up to 3× then fail soft.
    version: integer('version').notNull().default(0),
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
    check('pet_name_len_chk', sql`char_length(${t.name}) between 1 and 24`),
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
    // I2: same optimistic-concurrency dance as pet.
    version: integer('version').notNull().default(0),
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
    // NULL means "intentionally not deduped" (admin grants, retries with new id).
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Partial unique — NULL dedupeKey rows skip the constraint.
    uniqueIndex('pet_ledger_dedupe_uq')
      .on(t.coupleId, t.dedupeKey)
      .where(sql`${t.dedupeKey} is not null`),
    index('pet_ledger_couple_created_idx').on(t.coupleId, t.createdAt.desc()),
    check('pet_ledger_kind_chk', sql`${t.kind} in ('earn','spend','adjust')`),
  ]
);

// Shop catalogue — seeded data, not user-managed. Versioned via
// migrations so prices can be re-balanced without code edits. (S1)
export const petShopItem = pgTable(
  'pet_shop_item',
  {
    id: text('id').primaryKey(),    // slug, eg 'hat_paper_crown'
    kind: text('kind').notNull(),   // 'cosmetic' | 'treat' | 'furniture' | 'buff'
    slot: text('slot'),             // cosmetic slot: 'hat' | 'scarf' | 'expression' | null
    nameKey: text('name_key').notNull(),         // i18n key, eg 'shop_item_hat_paper_crown_name'
    descriptionKey: text('description_key').notNull(), // i18n key
    priceCoins: integer('price_coins').notNull(),
    minStage: text('min_stage').notNull().default('egg'), // 'egg' | 'baby' | 'grown'
    enabled: boolean('enabled').notNull().default(true),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [
    check('pet_shop_item_kind_chk',
      sql`${t.kind} in ('cosmetic','treat','furniture','buff')`),
    check('pet_shop_item_min_stage_chk',
      sql`${t.minStage} in ('egg','baby','grown')`),
    check('pet_shop_item_price_chk', sql`${t.priceCoins} >= 0`),
  ]
);

// Per-couple inventory. Cosmetics + furniture are persistent; treats
// + buffs are consumable (qty decremented on use, row kept at qty=0
// so we retain ownership history).
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
    // Partial: at most ONE equipped row per (couple, slot). Enforced via
    // a partial unique index joined to pet_shop_item at migration time
    // using a generated column or a trigger — see 0022_pet.sql.
    check('pet_inventory_qty_chk', sql`${t.qty} >= 0`),
  ]
);

// Phase 5 only — buffs with active windows. Punted from v1 schema.
// Slug carried here for migration planning, NOT created in P1.
// export const petBuff = pgTable('pet_buff', { … activeUntil … });
```

### Why a ledger + dedupe key?

1. **Idempotency.** All earn paths funnel through `awardForEvent(coupleId, source, dedupeKey)`. The unique index on `(coupleId, dedupeKey)` makes double-fire (eg a retried POST) a no-op at the DB level — see *Concurrency model* below for the exact transaction shape (I1).
2. **Auditability.** The /pet activity strip and any future debugging just `SELECT * FROM pet_ledger WHERE couple_id = ? ORDER BY created_at DESC LIMIT 20`. No reconstruction from event tables.

---

## Concurrency model

This is the hardest part of the system; documenting it explicitly so
future contributors don't re-introduce the bugs we considered.

### Earn path (`awardForEvent`)

Both partners can race the same dedupeKey from different CF Worker
isolates in the same millisecond (e.g. they both press "reveal" within
a few ms after both having submitted). The single source of truth is
the partial unique index `pet_ledger_dedupe_uq`.

```ts
// All inside one Postgres transaction (BEGIN ... COMMIT):
const [inserted] = await tx
  .insert(petLedger)
  .values({ coupleId, userId, kind: 'earn', source, coinsDelta, xpDelta, dedupeKey })
  .onConflictDoNothing({ target: [petLedger.coupleId, petLedger.dedupeKey] })
  .returning();

if (!inserted) {
  // Loser of the race. Read the winning row so the caller has the
  // canonical answer, but apply NO further effect.
  return readWinningLedger(tx, coupleId, dedupeKey);
}

// Winner of the race. Bump wallet + pet stats with optimistic
// concurrency: WHERE version = ? RETURNING. On miss, retry up to 3×;
// on persistent miss, log audit_log and treat as soft-failure (the
// ledger row stays — wallet will reconcile on next earn).
await applyWalletDelta(tx, coupleId, coinsDelta);
await applyPetXpAndDecayPersist(tx, coupleId, xpDelta);
```

Key properties:

- The unique-violation **does not abort the transaction** because
  `ON CONFLICT DO NOTHING` is in-statement. Postgres rolls back nothing.
- We avoid `pg_advisory_xact_lock` because the unique index already
  serialises winners-vs-losers, and advisory locks add a per-key
  contention point we don't need at our scale.
- The wallet/pet update is **inside the same transaction** as the
  ledger insert. A partial failure (network drop after ledger insert,
  before wallet update) leaves the wallet under-credited; the next
  earn detects this via a periodic "ledger sum vs wallet" sanity
  check (Phase 5, in the Diagnostics view) and emits an `adjust`
  ledger row to correct it. **We accept brief eventual consistency**
  rather than a 2-phase commit.

### Decay path

Reads project decay in-memory and **never** write. Writes (any earn /
buy / treat) recompute decay from `mood_updated_at` and persist along
with their own change, all under the optimistic `version` check. If
the version check fails 3×, we drop the decay-write and rely on the
next write to retry; the ledger row is still good.

### Solo-vs-mutual decision

`mutual: true` is **set by the caller**, not inferred inside
`awardForEvent`. The caller (`daily.ts`, `mood.ts`, etc.) knows whether
both partners' rows are present at hook time. `awardForEvent` halves
the table-defined constants when `mutual: false`.

---

## Real-time sync (decision: YES — debounced snapshot broadcast)

**Decision:** when partner A writes the pet (earn / buy / treat / equip),
the server emits **one snapshot event** on the existing per-couple
private channel; partner B's `/pet` (and `/pulse` badge) refresh from
the payload without an extra DB read. **Decay is not broadcast** — both
clients project it locally from `(stored_value, updated_at, now())` so
they always agree without traffic.

### Architecture (mirrors the existing Pulse / Mood pattern)

- Channel: reuse `couple:<coupleId>` from `src/lib/server/realtime.ts`
  (`topicForCouple`). Pet adds **one** new event type to the
  `ServerEvent` union in `src/lib/realtime/protocol.ts`:
  ```ts
  { t: 'pet_state'; ts: number; p: PetSnapshot }
  ```
  where `PetSnapshot` = `{ pet, wallet, equipped, version }` — i.e.
  the exact response of `GET /api/pet`. Snapshots, not deltas, because
  state is < 1 KB and snapshots are self-healing on reconnect (no
  cursor / replay machinery — see [event-sourcing reconnect
  guidance](https://martinfowler.com/eaaDev/EventSourcing.html); for
  small state, snapshot-on-every-write is the lowest-complexity
  correct option).
- Server: a new `broadcastPetState(coupleId)` helper in
  `src/lib/server/services/pet.ts` builds the snapshot from the same
  rows just written and calls `broadcastToCouple(coupleId, { t: 'pet_state', … })`.
  Every write path (`awardForEvent`, `buyItem`, `consumeTreat`,
  `equipCosmetic`, `hatchPet`, `renamePet`) ends with **one**
  `await broadcastPetState(coupleId)` after the transaction commits.
  Wrapped in `try/catch` — broadcast failure is logged to `audit_log`
  and never breaks the write (mirrors `awardForEvent` failure mode).
- Security: identical to the Pulse model. Channel is **private**;
  `realtime.messages` RLS in `drizzle/manual/0003_realtime_rls.sql`
  (helper `app.is_couple_topic_member()`) already restricts both
  SELECT and presence INSERT to authenticated couple members. **No
  new RLS migration needed.** Clients cannot INSERT broadcasts (policy
  default-denies) — all pet broadcasts originate from server REST via
  `SUPABASE_SECRET_KEY`, exactly like `location_update` and
  `mood_change`. No partner-spoofing surface.
- Client subscribe: extend `src/lib/client/realtime.svelte.ts` to
  switch on `'pet_state'` and update a new `petSnapshot` Svelte rune.
  `/pet/+page.svelte` and `PetBadge.svelte` read from this rune; on
  event arrival they replace local state entirely. No diff/merge
  logic — the snapshot is the truth.

### Server-side debounce / coalescing (race protection)

Bursty earn paths (e.g. both partners reveal within seconds) would
otherwise emit 2 snapshots back-to-back, with the second one strictly
newer. We coalesce in-process per Worker isolate using a Map keyed by
`coupleId` with a **2 s trailing-edge debounce** — the latest snapshot
wins, intermediate ones are dropped before broadcast. Implementation
shape in `src/lib/server/services/pet.ts`:

```ts
const pendingPetBroadcast = new Map<string, ReturnType<typeof setTimeout>>();
function scheduleBroadcast(coupleId: string, snap: PetSnapshot) {
  clearTimeout(pendingPetBroadcast.get(coupleId));
  pendingPetBroadcast.set(coupleId, setTimeout(() => {
    pendingPetBroadcast.delete(coupleId);
    void broadcastToCouple(coupleId, { t: 'pet_state', ts: Date.now(), p: snap });
  }, 2000));
}
```

Caveat: Cloudflare Worker isolates are short-lived. `setTimeout` only
holds the broadcast for the lifetime of one isolate, so coalescing is
**best-effort** across requests in the same isolate, **not** across
isolates. That is OK because the snapshot includes `pet.version` /
`wallet.version` — receivers ignore any snapshot whose `version` is
not strictly greater than what they already display. Out-of-order or
duplicate snapshots are idempotent at the receiver.

### Receiver UX

- On `pet_state` arrival: replace local snapshot, run the **coin-earn
  +N float** animation only if `wallet.version` increased and the
  receiver tab is the *other* partner (we know this because
  `presence.userId` is tracked on the same channel). No animation on
  own writes (those animate from the optimistic local update). All
  animations respect `prefers-reduced-motion`.
- No toast, no sound, no badge dot. The animation IS the notification.
- If `pet_state.p.pet === null` after a hatch, run the one-time
  hatch fade-in (same anim Phase 3 ships).

### Reconnect strategy

`realtime.svelte.ts` already retries with `setAuth` rotation on
`auth.onAuthStateChange`. On any `SUBSCRIBED` event after a gap, the
client calls `GET /api/pet` once to **reseed** local state — equivalent
to a forced snapshot. This handles offline-then-online and tab
backgrounding. Cost: 1 cached request per reconnect per partner — well
within the existing budget.

### Cost ceiling

Worst-case per couple: 7 mutual writes/day × debounce-coalesced to
≤ 7 broadcasts × (1 send + 2 receivers) = **21 messages/day/couple**.
At 100 000 active couples: 2.1 M messages/day → ~63 M/month, which is
above Free (2 M) and Pro (5 M), priced at $2.50 per additional 1 M
([Supabase Realtime pricing](https://supabase.com/docs/guides/realtime/pricing)).
Real-world rate will be far lower (most days have 1–3 writes, not 7).
Re-evaluate at 10 k couples; if cost matters, drop debounce window to
5 s or coalesce per-minute.

---

## 3. Server architecture

New module: `src/lib/server/services/pet.ts`. Mirrors `bucketList.ts`
and `quiz.ts` conventions (validation errors as a typed class, all
queries through `db` from `$lib/server/db`).

```ts
// Public API.
export async function getPetState(coupleId: string): Promise<PetState | null>;
export async function hatchPet(coupleId: string, species: Species, name: string): Promise<PetState>;
export async function renamePet(coupleId: string, name: string): Promise<PetState>;

// Idempotent: same (coupleId, dedupeKey) → no-op + returns the original.
// Caller decides solo vs mutual.
export async function awardForEvent(args: {
  coupleId: string;
  userId: string | null;
  source: EarnSource;          // 'daily_reveal' | 'mood_log' | …
  dedupeKey: string;
  mutual: boolean;
}): Promise<{ coinsDelta: number; xpDelta: number; ledgerId: string; deduped: boolean }>;

export async function listShopItems(coupleId: string): Promise<PetShopItem[]>;
export async function buyItem(coupleId: string, userId: string, itemId: string): Promise<PetInventoryEntry>;
export async function equipCosmetic(coupleId: string, itemId: string, equipped: boolean): Promise<void>;
export async function consumeTreat(coupleId: string, userId: string, itemId: string): Promise<PetState>;

// Phase 5
export async function listLedger(coupleId: string, limit?: number): Promise<PetLedgerEntry[]>;
```

**Lazy decay** is implemented inside `getPetState`, AND a matching
client-side projection ships in `src/lib/pet.constants.ts` so partners
agree without broadcasting tick events:

```ts
// Server (pet.ts) and client (pet.constants.ts) share this pure fn:
export function projectDecay(stored: { mood: number; hunger: number;
  moodUpdatedAt: Date; hungerUpdatedAt: Date }, now = new Date()) {
  const moodDays   = (now.getTime() - stored.moodUpdatedAt.getTime())   / 86_400_000;
  const hungerDays = (now.getTime() - stored.hungerUpdatedAt.getTime()) / 86_400_000;
  return {
    mood:   clamp(stored.mood   - 5 * moodDays,   20, 100),
    hunger: clamp(stored.hunger + 5 * hungerDays,  0,  80),
  };
}
// Server: persist projected values on the next WRITE path; reads stay read-only (D1).
// Client: re-call projectDecay() every 30 s (rune effect) so the bars
// drift live without any server message — the broadcast-decay
// reconciliation strategy (E).
```

The client and server use the **same** function and the **same**
constants module, so a snapshot from realtime + a 30 s local re-projection
are guaranteed to converge on identical values.

Constants live in `src/lib/pet.constants.ts` (parallel to
`bucketList.constants.ts`). Same module is importable client-side for
UI thresholds.

### Wiring earn events into existing services

Each existing service gets one additional line — a fire-and-forget
`awardForEvent` after the existing happy path. None of the existing
service contracts change. **`awardForEvent` is awaited before the
response returns** (P1) so we never lose grants to closed DB bundles.

| Service | Actual function name (verified) | dedupeKey shape | Mutual? |
|---|---|---|---|
| `daily.ts` — `submitDailyAnswer` | line 120 | `daily_send:<userId>:<YYYY-MM-DD>` | `mutual = false` (always solo) |
| `daily.ts` — inside `loadDaily` when `revealed && !alreadyAwarded` | line 75 | `daily_reveal:<questionId>:<YYYY-MM-DD>` | `mutual = true` |
| `mood.ts` — `setMood` | line 62 | `mood_log:<userId>:<YYYY-MM-DDTHH>` (hour-bucket → 3/day max) | `mutual = false` |
| `quiz.ts` — `submitFinal` (NOT `finaliseRun`) | line 340 | `quiz_complete:<runId>` | `mutual = true` (only fires when both partners final) |
| `bucketList.ts` — `markDone` | line 167 | `bucket_complete:<itemId>` | `mutual = true` |
| `repair.ts` — `completeSession` (NOT `markResolved`) | line 234 | `repair_complete:<sessionId>` | `mutual = true` |
| anniversary | a layout-load check in `+layout.server.ts` | `anniversary:<YYYY>` | `mutual = true` |

> **Plan correction:** the original plan named `revealDaily` /
> `finaliseRun` / `markResolved` — none exist. The verified names are
> in the table above. The daily reveal hook lives inside `loadDaily`
> at the point where the function computes `revealed = !!mine && !!partnerRow`.

`awardForEvent` returns `{ coinsDelta: 0, xpDelta: 0, deduped: true }`
on dedupe-hit so callers can ignore it; UI doesn't surface a toast in
that case.

### Failure mode

`awardForEvent` is wrapped in a try/catch so a pet-side failure
**never** breaks a relationship ritual. A failed award writes one row
to `audit_log` with `action = 'pet.award.failed'` + the source +
dedupeKey + error message, then silently no-ops. Manual reconciliation
is via the same `INSERT ... ON CONFLICT` shape — re-running the hook
is always safe.

---

## 4. API routes

All under `src/routes/api/pet/`. JSON in/out, auth via `event.locals.user`
+ `event.locals.couple` (same hooks as the rest of the app). All
`href` strings inside server redirects must use `resolve()` from
`$app/paths` per the eslint-plugin-svelte rule (project convention).

| Method · path | Body | Returns |
|---|---|---|
| `GET    /api/pet` | — | `{ pet: PetState \| null, wallet, equipped: PetInventoryEntry[] }` |
| `POST   /api/pet/hatch` | `{ species, name }` | `PetState` (only valid when no pet exists) |
| `PATCH  /api/pet` | `{ name }` | `PetState` |
| `GET    /api/pet/shop` | — | list of `PetShopItem` filtered by current stage + `enabled` |
| `GET    /api/pet/inventory` | — | list of owned items (qty > 0) |
| `POST   /api/pet/buy` | `{ itemId }` | `{ wallet, inventoryEntry }` |
| `POST   /api/pet/equip` | `{ itemId, equipped }` | `PetState` (cosmetic only) |
| `POST   /api/pet/treat` | `{ itemId }` | `PetState` (decrements qty) |
| `GET    /api/pet/ledger?limit=20` | — | last N ledger rows for /pet activity strip |

Validation rules:

- `species` ∈ {fox,cat,bird,capybara}; `name` 1–24 chars, no newlines, NFKC-normalised.
- `buy` returns **402 Payment Required** if coins < price.
- `equip` returns **409 Conflict** if another item is already in that slot
  (server auto-unequips on the *next* equip; explicit unequip via
  `equipped: false`).
- `treat` returns **404** if qty = 0.
- Write endpoints succeed **regardless** of `couple.status` (no 423
  Locked — pause logic was rejected, see C1 / *Anti-coercion when one
  partner stops*). The only thing `couple.status == 'broken'` changes
  is that the partner-presence avatar in `/pet` is suppressed.
- Every successful write ends with `await broadcastPetState(coupleId)`
  (debounced; see *Real-time sync*). Broadcast failures are logged
  but never fail the write.

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

- `/pulse` — small pet badge in the header strip, next to the partner avatars. Tappable, links to `/pet` (via `resolve('/pet')`). Shows current mood frame. **Not** a notification dot — it's just present.
- After any qualifying event (`daily_reveal`, `quiz_complete`, etc.) the existing success toast/route gets a *single* extra line:
  `+8 coins · {petName} is happy.` (Notice primitive, tone="success".)
- Settings → Diagnostics: new link "Pet ledger" → read-only view of all ledger rows for the couple (transparency + debugging).

### Components / primitives to add

| Component | Purpose | Lives at |
|---|---|---|
| `PetSprite.svelte` | Renders the right species+stage+mood SVG with breathing anim. Lazy-imports the species sprite map. | `src/lib/components/pet/PetSprite.svelte` |
| `CoinIcon.svelte` | Hand-drawn coin SVG (single source of truth, never emoji). | `src/lib/components/pet/CoinIcon.svelte` |
| `MoodHungerBars.svelte` | Two sketchy bars with subtle wiggle (respects `prefers-reduced-motion`). Props: `{ mood: number; hunger: number }`. | `src/lib/components/pet/MoodHungerBars.svelte` |
| `ShopCard.svelte` | One shop tile (icon + name + price + locked overlay). Props: `{ item: PetShopItem; ownedQty: number; affordable: boolean; onBuy: () => void }`. | `src/lib/components/pet/ShopCard.svelte` |
| `HatchFlow.svelte` | Species + name + hatch CTA wizard. | `src/lib/components/pet/HatchFlow.svelte` |
| `PetBadge.svelte` | Tiny header badge for `/pulse`. ONE shared SVG, ~1 KB gzipped. | `src/lib/components/pet/PetBadge.svelte` |

All re-use existing primitives (`Card`, `PillButton`, `Notice`,
`Spinner`, `ChoiceChip`, `InputField`, `Tabs`). No new daisyUI classes.

### SVG pipeline (decision deferred from Phase 0)

**Final art style is locked at Phase 3.** Until then, sprites ship as
**paper-coloured rounded rectangles** with the species name inside —
this lets every other phase land without blocking on art direction.

Pipeline once style is locked:

1. **Author**: hand-sketch on paper → photograph → trace in **Figma**
   (one frame per `(species, stage, mood)`, 96×96 px artboard, 2 px
   stroke). Inkscape used only for path-cleanup / node-reduction
   passes ([SVG optimisation](https://web.dev/articles/optimize-svg)).
2. **Optimise**: each export piped through **SVGO** (already wired in
   the build via `vite-plugin-svgo` / equivalent). Per-file budget
   ≤ 1.2 KB raw / ≤ ~400 B gzipped. CI assertion in P6.
3. **Bundle layout**: 
   - **`/pet`** lazy-imports the active species' 9 frames (3 stages × 3
     moods) via `import('$lib/assets/pet/${species}/${stage}-${mood}.svg?raw')`.
     Other species never enter the chunk.
   - **`/pulse`** ships ONE eager import: the current species' current
     `(stage, mood)` SVG, ~1 KB gzipped, baked into `PetBadge`. No
     SVG `<symbol>` sprite — inline `?raw` strings are smaller for
     this volume (12 frames total per species) and let CSS variables
     (`currentColor`) drive cosmetic tints. ([inline vs sprite
     trade-off](https://css-tricks.com/svg-symbol-good-choice-icons/))
4. **Animation**: **CSS keyframes only.** No SMIL (deprecated, broken
   on mobile Safari), no Lottie (~30 KB lib + JSON ≫ our budget).
   Idle "breathe" = `transform: scaleY(1 → 1.02 → 1)` over 4 s on the
   sprite root group. Stage-up = opacity cross-fade with `clip-path`
   wipe. All wrapped in the project-wide `prefers-reduced-motion`
   reset — the sprite goes still, no opacity change. ([CSS keyframes
   vs Lottie perf for small idle anims](https://lottiefiles.com/blog/working-with-lottie/lottie-performance))
5. **Accessibility**: every sprite gets `<title>` + `<desc>` set by
   `PetSprite.svelte` from i18n keys (`pet_a11y_<species>_<stage>_<mood>`),
   `role="img"`, and `aria-label` on the wrapping link. The `/pulse`
   badge is `aria-hidden="true"` because the partner-avatar row already
   labels it.

### Motion

- Idle breathing: 4 s `transform: scaleY(1) → 1.02 → 1` SVG transform.
- Coin earn: floating "+N" rises 24 px and fades over 600 ms.
- Stage-up: brief paper-fold anim (the previous stage SVG dissolves, the
  new one fades in over 800 ms). One-time per stage.
- All anims wrapped in the global `prefers-reduced-motion` reset.

### i18n

All copy goes to `messages/en.json` + `messages/zh-hant.json` and is
regenerated with **`bunx paraglide-js compile --outdir ./src/lib/paraglide`**
(the bare command writes to the wrong dir — this is a known repo
gotcha). Key prefix `pet_*` and `shop_item_<id>_name` /
`shop_item_<id>_description`. Approximate count for v1: ~60 new keys
(shop seed of 12 items × 2 strings = 24, plus UI labels and ledger
sources).

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

Every task description below answers: **(a) files** · **(b) signatures
/ types** · **(c) verification** · **(d) what could go wrong**.

### Phase 0 — Risks & decisions to lock (RESOLVED)

All five Phase 0 questions have been resolved by the second-pass review.
Listed here for traceability; no Phase-0 work remains.

- [x] **P0.1 Realtime sync in v1?** → **YES, debounced snapshot
      broadcast.** Single `pet_state` event on the existing
      `couple:<id>` channel after every write, 2 s trailing-edge
      debounce per couple, snapshot payload (not delta), receivers
      version-gate. Decay never broadcast (clients project locally).
      See *Real-time sync* §.
- [x] **P0.2 Decay paused on broken/paused couple?** → **NO, continues
      always.** The 20-mood / 80-hunger floors already cap visible
      damage at "sleepy". Pausing logic would surface scorekeeping
      inferences (C1). See *Mood / hunger decay* and *Warm-decay copy
      matrix*.
- [x] **P0.3 Daily-reveal dedupe key?** → **YES, includes both:**
      `daily_reveal:<questionId>:<YYYY-MM-DD>`. Locked in §3 wiring
      table.
- [x] **P0.4 Migration number?** → **`drizzle/manual/0022_pet.sql`**.
      Last shipped is `0021_chat_messages_purge_cron.sql`.
- [x] **P0.5 SVG style guide?** → **Deferred to Phase 3.** Phases 1–2
      ship with placeholder paper-coloured rounded-rect sprites
      labelled with the species name. See *SVG pipeline* §5.

**New open decisions surfaced by this pass** (none block Phase 1):

- [ ] **N0.1 Debounce window value** — 2 s is a guess. Calibrate at
      Phase 4 against the realtime telemetry (P6.6) once we have a
      real burst distribution.
- [ ] **N0.2 Welcome-back free-treat cadence** — currently
      `welcome_back:<userId>:<YYYY-Q>` (max 1/quarter/partner).
      Confirm before P3 lands.
- [ ] **N0.3 Placeholder rect colour token** — pick one of
      `--color-paper-*` to keep the placeholder visible against
      both light/dark themes; cosmetic only.

### Phase 1 — Schema + ledger + state read

- [ ] **P1.1** Append the 5 Drizzle table objects (`pet`, `petWallet`,
      `petLedger`, `petShopItem`, `petInventory`) to
      `src/lib/server/db/app.schema.ts`. **Do NOT run `bun run db:generate`**
      — this repo uses manual SQL migrations (P2). Write the matching
      SQL by hand at `drizzle/manual/0022_pet.sql` including all
      indexes, check constraints, the partial-unique
      `pet_ledger_dedupe_uq`, and a slot-uniqueness trigger on
      `pet_inventory` (only one row per (couple, slot) may have
      `equipped = true`). Re-export the new tables from
      `src/lib/server/db/schema.ts`.
      - Verify: `psql "$DATABASE_URL" -f drizzle/manual/0022_pet.sql`
        on a scratch DB, then `bun run check` passes.
      - Failure mode: `db:generate` would attempt to introspect the
        existing manual schema and emit a phantom diff — guard by NOT
        running it (hard rule).
- [ ] **P1.2** Seed `pet_shop_item` rows in the same migration with
      `INSERT … ON CONFLICT (id) DO UPDATE SET kind=EXCLUDED.kind,
      slot=EXCLUDED.slot, name_key=EXCLUDED.name_key,
      description_key=EXCLUDED.description_key,
      price_coins=EXCLUDED.price_coins, min_stage=EXCLUDED.min_stage,
      enabled=EXCLUDED.enabled, sort_order=EXCLUDED.sort_order;`.
      All 12 v1 items.
      - Verify: `SELECT id, price_coins FROM pet_shop_item ORDER BY sort_order;` returns 12 rows.
      - Failure mode: re-running the migration on a DB where prices
        were hand-edited will reset them — that's *intended* (S1).
- [ ] **P1.3** Build `src/lib/server/services/pet.ts` with
      `getPetState`, `hatchPet`, `renamePet`, the shared
      `projectDecay()` helper (re-exported to client via
      `pet.constants.ts`), and `broadcastPetState()` debounced helper
      (see *Real-time sync* §). Mirror the validation-class pattern
      from `bucketList.ts` (`PetValidationError` with codes
      `species_invalid`, `name_empty`, `name_too_long`,
      `pet_already_exists`). **No `coupleStatusGuard`** — pet writes
      succeed regardless of `couple.status`.
      - Verify: unit test `pet.spec.ts` proves `getPetState` projects
        decay client-side without writing AND that `broadcastPetState`
        coalesces 5 calls within 2 s into 1 emission.
      - Failure mode: forgetting to `await` the broadcast promise
        risks losing it across CF Worker isolate teardown.
- [ ] **P1.4** Build SvelteKit route handlers
      `src/routes/api/pet/+server.ts` (GET + PATCH) and
      `src/routes/api/pet/hatch/+server.ts` (POST). Use
      `event.locals.couple.id` for couple scope; `event.locals.user.id`
      for `userId`. **No 423 Locked** — see §4.
      - Verify: `curl -X POST $BASE/api/pet/hatch -H 'Cookie: …' -d '{"species":"fox","name":"Mochi"}' | jq` then `curl $BASE/api/pet`.
      - Failure mode: deriving `coupleId` from the request body would
        be a tenancy bug — code review must reject.
- [ ] **P1.5** Unit tests in `src/lib/server/services/pet.spec.ts`:
      decay clamp (mood ≥ 20, hunger ≤ 80, no negative days),
      hatch idempotency (second call → `pet_already_exists`), name
      validation (empty, 25 chars, newlines, NFKC), version column
      starts at 0, broadcast helper coalesces.
      - Verify: `bun run test:unit -- --run --project server src/lib/server/services/pet.spec.ts`.

### Phase 2 — Earn pipeline

- [ ] **P2.1** Implement `awardForEvent` in `pet.ts` exactly as
      specified in *Concurrency model* above:
      single-statement `INSERT ... ON CONFLICT DO NOTHING RETURNING`,
      then optimistic-`version`-checked wallet/pet update wrapped in a
      transaction. Retry up to 3× on version-mismatch; on persistent
      failure write `audit_log{ action: 'pet.award.failed' }` and
      return `{ deduped: false, … 0 effects }`. **Must be awaited
      inside the request, never deferred to `event.waitUntil`** — the
      AsyncLocalStorage DB bundle is closed by then (P1).
      - Verify: integration spec races 10 concurrent `awardForEvent`
        calls with the same dedupeKey, asserts exactly one ledger row
        and one wallet credit.
      - Failure mode: forgetting the transaction means a crash between
        ledger insert and wallet update under-credits the wallet.
        Phase 5 reconciliation row will fix it; still surface as a
        warning in tests.
- [ ] **P2.2** Wire all 7 earn hooks at the EXACT call sites verified
      against the codebase:
      - `src/lib/server/services/daily.ts` after the insert in
        `submitDailyAnswer` (line 120) → `daily_send:<userId>:<YYYY-MM-DD>`, mutual=false.
      - `src/lib/server/services/daily.ts` inside `loadDaily` (line 75)
        when `revealed && !alreadyAwarded` (check via the dedupe key,
        not a flag) → `daily_reveal:<questionId>:<YYYY-MM-DD>`, mutual=true.
      - `src/lib/server/services/mood.ts` after the insert in
        `setMood` (line 62) → `mood_log:<userId>:<YYYY-MM-DDTHH>`, mutual=false.
      - `src/lib/server/services/quiz.ts` end of `submitFinal` (line 340)
        when *both* partners now final → `quiz_complete:<runId>`, mutual=true.
      - `src/lib/server/services/bucketList.ts` after `markDone`
        (line 167) returns true → `bucket_complete:<itemId>`, mutual=true.
      - `src/lib/server/services/repair.ts` end of `completeSession`
        (line 234) → `repair_complete:<sessionId>`, mutual=true.
      - `src/routes/+layout.server.ts` (or new `src/lib/server/services/anniversary.ts`)
        on each load when today === couple.anniversary →
        `anniversary:<YYYY>`, mutual=true. Cap by year via dedupeKey.
      - Verify: end-to-end Vitest server spec for each hook fires the
        award and the second call is a no-op.
      - Failure mode: forgetting `await` would re-introduce P1
        (orphaned DB op). ESLint `@typescript-eslint/no-floating-promises`
        is already enabled in this repo and will catch it.
- [ ] **P2.3** Define `src/lib/pet.constants.ts` exporting:
      `EARN_TABLE: Record<EarnSource, { coinsFull: number; xpFull: number; mutualOnly: boolean }>`,
      `STAGE_THRESHOLDS = { egg: 0, baby: 50, grown: 250 } as const`,
      `MOOD_FLOOR = 20`, `HUNGER_CEIL = 80`, `DECAY_PER_DAY = 5`,
      `NAME_MAX = 24`, `TREAT_EFFECTS: Record<string, { mood: number; hunger: number }>`.
      - Verify: tests import this file rather than literal numbers.
- [ ] **P2.4** Tests: idempotency (same dedupeKey twice → 1 ledger
      row, 1 grant), mutual/solo halving (solo gets `floor(coinsFull/2)`),
      daily cap (`mood_log` 4× in same hour → 1 ledger row), audit_log
      written on simulated failure.
- [ ] **Verify:** Sign in as both partners (two browsers), both
      reveal daily, wallet shows `coins == 8` exactly once.

### Phase 3 — `/pet` route + habitat UI

- [ ] **P3.1** Stage 1 art pass: ship **placeholder sprites only** —
      one paper-coloured rounded-rect SVG per `(species, stage, mood)`,
      96×96, with the species name centred. 36 files at
      `src/lib/assets/pet/<species>/<stage>-<mood>.svg`. Each ≤ 300 B
      raw / ~150 B gzipped. Final art lands in a follow-up PR per the
      *SVG pipeline* §; this PR proves the lazy-import wiring works.
      - Failure mode: skipping the placeholders means `/pet` ships
        broken until the artist delivers — unacceptable. Placeholders
        unblock everyone.
- [ ] **P3.2** Build the 6 components listed in §5. `PetSprite.svelte`
      uses `await import('$lib/assets/pet/${species}/${stage}-${mood}.svg?raw')`
      so only the active species is in the `/pet` chunk; `PetBadge.svelte`
      imports its single sprite eagerly because it ships with `/pulse`.
      Both subscribe to the new `petSnapshot` rune (see *Real-time sync*).
      - Verify: Storybook stories render each at three moods.
- [ ] **P3.3** `src/routes/pet/+page.svelte` + `src/routes/pet/+page.server.ts`.
      `+page.server.ts` calls `getPetState` + `listShopItems` +
      inventory in parallel. Mounts a `$effect` that re-runs
      `projectDecay()` every 30 s against the current snapshot so the
      mood/hunger bars drift without server traffic. All client-side
      `<a href>` use `resolve('/pet')` from `$app/paths`.
      - Verify: `/pet` SSRs in <100 ms on local; Lighthouse PWA score unchanged.
- [ ] **P3.4** `src/routes/pulse/+page.svelte` header gets the
      `<PetBadge />` next to existing partner avatars. Tappable link
      to `resolve('/pet')`. Subscribes to the same `petSnapshot` rune
      as `/pet` for live updates.
- [ ] **P3.5** Storybook stories for each new component
      (`*.stories.svelte`) with happy / mid-mood / low-mood variants.
- [ ] **Verify:** Hatch flow → habitat renders → idle breathing
      animates (or stills under `prefers-reduced-motion`).

### Phase 4 — Shop + inventory + treats

- [ ] **P4.1** Implement `listShopItems`, `buyItem`, `consumeTreat`,
      `equipCosmetic` in `pet.ts`. `buyItem` is the second
      transactional path (after `awardForEvent`) — it must use the
      same wallet-version-check retry loop and write a `petLedger`
      row with `kind = 'spend'` and `dedupeKey = null` (purchases are
      not deduped at the row level; the user can re-buy a consumable).
      **Each of `buyItem`, `consumeTreat`, `equipCosmetic` ends with
      `scheduleBroadcast(coupleId, snapshot)`** (debounce coalesces
      bursts; partner sees one snapshot per 2 s window).
      - Failure mode: forgetting the spend-ledger row breaks audit;
        Phase 5 reconciliation will detect the wallet-vs-ledger drift.
- [ ] **P4.2** Endpoints at `src/routes/api/pet/shop/+server.ts`,
      `src/routes/api/pet/inventory/+server.ts`,
      `src/routes/api/pet/buy/+server.ts`,
      `src/routes/api/pet/equip/+server.ts`,
      `src/routes/api/pet/treat/+server.ts`. All return JSON; status
      codes per §4.
- [ ] **P4.3** Shop tab + Wardrobe tab in `/pet`. Use existing `Tabs`
      primitive. Locked items (stage-gated) render dimmed with a
      Notice "Unlocks at Baby stage" — never "you can't have this".
- [ ] **P4.4** Treat consumption animation (mood bar fills with
      bounce, ≤ 600 ms, reduced-motion-safe). Triggered by **own
      action** locally; the partner's identical animation runs off
      the inbound `pet_state` snapshot's `wallet.version` increment.
- [ ] **P4.5** Tests: 402 on insufficient coins, slot collision
      auto-unequip, treat qty decrement to 0 leaves the row (history),
      buying a stage-locked item returns 403, **two concurrent
      `buyItem` calls on the same wallet → exactly one succeeds, one
      gets 409 retry-and-fail with version mismatch**.
- [ ] **Verify:** Buy `treat_strawberry` with 10 coins, consume it,
      `mood` jumps +20, `hunger` drops to 0. Partner's `/pet` (open
      in second browser) shows the same change within ≤ 2 s.

### Phase 5 — Buffs + activity strip + ledger view + reconciliation

- [ ] **P5.1** Add `petBuff` table (`couple_id`, `kind`,
      `multiplier`, `active_until`, unique on `(couple_id, kind)`)
      via `drizzle/manual/0023_pet_buffs.sql`. Update `awardForEvent`
      to multiply when an active buff matches the source kind.
      Multiplier capped at ×2.0 to avoid runaway grants.
- [ ] **P5.2** `GET /api/pet/ledger` + activity strip in /pet "Pet"
      tab (last 5 entries, source label only — never which partner).
- [ ] **P5.3** Settings → Diagnostics → "Pet ledger" debug link
      (read-only, paginated 50/page) AND a "Reconcile wallet" button
      that runs `SELECT sum(coins_delta) FROM pet_ledger WHERE …`,
      compares against `pet_wallet.coins`, and writes an `adjust`
      ledger row + bumps `pet_wallet.version` if they differ.
- [ ] **P5.4** Stage-up paper-fold animation.
- [ ] **Verify:** Activate `buff_doublecoin`, complete a quiz, ledger
      row shows 18 coins (= 12 × 1.5) on the audit page.

### Phase 6 — Polish & telemetry

- [ ] **P6.1** zh-hant pass on all ~60 new keys. Run
      `bunx paraglide-js compile --outdir ./src/lib/paraglide` (the
      bare `paraglide-js compile` writes to the wrong dir — this repo
      gotcha is in `AGENT.md`).
- [ ] **P6.2** Playwright e2e at `e2e/pet.test.ts`: hatch → earn →
      buy → equip flow, plus a "long absence" path that fast-forwards
      `mood_updated_at` 95 days back via SQL fixture and asserts the
      welcome-back Notice + free treat appear exactly once.
- [ ] **P6.3** Storybook coverage for happy / mid-mood / low-mood states.
- [ ] **P6.4** Empty-state copy ("no pet yet", "shop locked at this
      stage", "no items owned") + the four warm-decay strings from
      §1; tone matches `audit_empty` — warm, no FOMO.
- [ ] **P6.5** README "Pet system" subsection + add `/pet` to the
      routes list at the top of `README.md`.
- [ ] **P6.6** Telemetry: emit a single `audit_log` row on first
      `/pet` mount per session (`action = 'pet.visit'`) AND a counter
      on every successful `pet_state` broadcast send +
      `pet_state_received_seen` on the client (presence-tracked, so
      we know if the *other* partner had `/pet` mounted at receive
      time). Powers debounce-window calibration (N0.1) and validates
      whether the broadcast is moving the needle (not a gate — the
      decision is locked).

---

## 8. Migration rollback

If we abandon the feature **before** users have hatched a pet, drop
the migration in a follow-up:

```sql
-- drizzle/manual/00xx_pet_rollback.sql
DROP TABLE IF EXISTS pet_inventory CASCADE;
DROP TABLE IF EXISTS pet_ledger CASCADE;
DROP TABLE IF EXISTS pet_wallet CASCADE;
DROP TABLE IF EXISTS pet_shop_item CASCADE;
DROP TABLE IF EXISTS pet CASCADE;
-- Phase 5 only:
DROP TABLE IF EXISTS pet_buff CASCADE;
```

If we abandon **after** hatches, the pet UI must be removed but the
data preserved (users may treasure their pet's name). The tooling:

1. Hide `/pet` route by guarding `+layout.server.ts` with a
   `KILL_SWITCH_PET=true` env flag.
2. Remove all 7 earn hooks (one-line removals).
3. Leave the tables; new earns simply stop. A future cleanup can drop
   them after a one-month sunset notice.

`audit_log` rows from `pet.award.failed` and `pet.visit` are
self-contained and need no cleanup.

---

## 9. Cloudflare Workers cost & latency

Expected p95 added latency on existing endpoints from the
`awardForEvent` hook. All numbers are estimates against current
Supabase pooler RTT (~5 ms us-east → us-east).

| Endpoint | Extra DB ops | Estimated p95 added |
|---|---|---|
| `submitDailyAnswer` | 1 INSERT (ledger) + 1 UPDATE (wallet) + 1 UPDATE (pet) | ~12 ms |
| `loadDaily` (when reveal hits) | same | ~12 ms (only on first reveal of the day) |
| `setMood` | same, but skipped on within-hour dedupe (no DB write) | ~12 ms cold, ~3 ms when deduped |
| `submitFinal` (quiz) | same; once per pack ever | ~12 ms |
| `markDone` (bucket) | same; once per item | ~12 ms |
| `completeSession` (repair) | same; once per session | ~12 ms |
| anniversary check in layout | dedupe-hit on every load except the year's first | ~3 ms (mostly the `INSERT ... ON CONFLICT DO NOTHING` returning 0 rows) |

Connection pool: each request still uses the existing per-request
postgres-js bundle (`max: 1`), so no new connections are opened. The
3 extra statements share that connection. Supabase free-tier pooler
limit (200 connections) is unaffected by per-request statement count.

Realtime: **bounded by earn rate.** Worst-case 7 writes/day/couple ×
3 messages each (1 send + 2 receivers, debounce-coalesced) =
**21 messages/day/couple**. At 100 k couples ≈ 63 M/month — overflows
Pro tier ($2.50/M overage); at 10 k couples ≈ 6.3 M/month, still inside
Pro. ([Supabase Realtime pricing](https://supabase.com/docs/guides/realtime/pricing))
Decay is **never** broadcast — clients project locally from
`(stored, updated_at, now())` so partner agreement requires zero
extra messages.

Bundle delta budget: `/pet` chunk < 80 KB gzipped (asserted in P6).
`/pulse` delta < 2 KB gzipped (just `PetBadge` + one sprite).

---

## 10. Done when

- [ ] `GET /api/pet` returns a hatched pet for any couple that hit `/pet` once.
- [ ] All 7 earn sources fire exactly once per dedupe-key under retry,
      verified by an integration test that races 10 concurrent calls.
- [ ] Wallet, inventory, equip, treat all work end-to-end through the UI.
- [ ] Pet visibly evolves egg → baby → grown as XP accrues; never regresses.
- [ ] No emoji used anywhere in the new feature; everything is SVG or text.
- [ ] No new daisyUI residue (raw `btn-*` classes); only the existing primitives.
- [ ] All copy in en + zh-hant; no hard-coded English; Paraglide compiled
      via `bunx paraglide-js compile --outdir ./src/lib/paraglide`.
- [ ] `bun run test` (unit + Playwright) green; `bun run check`,
      `bun run lint`, `bun run build` green.
- [ ] Bundle delta on the `/pet` chunk is < 80 KB gzipped; `/pulse`
      delta < 2 KB gzipped (asserted).
- [ ] Decay never produces values outside the documented 20 / 80 floors.
- [ ] Pet writes succeed regardless of `couple.status` (no 423; pause
      logic was rejected — see C1 / *Anti-coercion*).
- [ ] Wallet-vs-ledger reconciliation tool reports zero drift after
      the e2e suite.
- [ ] Partner B's `/pet` updates within ≤ 2 s of partner A's write
      (asserted in P4.5 e2e).
- [ ] Long-absence return shows the welcome-back Notice + free treat
      exactly once per quarter per partner.

---

## 11. Open questions (defer to implementation)

1. **Where does name profanity get filtered?** Probably nowhere — the
   pet name is only visible to the partner. Keep it loose.
2. **Push notifications?** Punted. The `purpose = tamagotchi-lite`
   choice said "decay yes, never lethal". Pushing "your pet is hungry"
   violates the anti-coercion rule (N1).
3. **Pet death / rebirth?** Explicit non-goal. Confirmed by the
   *decay capped at 20 mood / 80 hunger* spec.
4. **Cross-couple visibility?** None. The pet is private to one couple,
   exactly like every other DuoSync data type.
5. **Re-balancing strategy?** Constants live in
   `src/lib/pet.constants.ts`; shop prices live in `pet_shop_item`.
   A balance pass = a new migration (S1 — never edit an old one) +
   a constants bump + a regression test on the new floor values.
6. **For the human to decide before Phase 1** (P0): all five locked —
   see *Phase 0 — RESOLVED* in §7.
7. **New, surfaced by the second-pass review** (don't block Phase 1):
   debounce window value (N0.1), welcome-back free-treat cadence
   (N0.2), placeholder rect colour token (N0.3). Listed under §7
   Phase 0.

---

## 12. Skills & sources consulted

Skills:

- `brainstorming/SKILL.md` — Socratic gate enforced before writing this plan.
- `game-development/game-design/SKILL.md` — core-loop, motivation, reward schedules, anti-patterns.
- `database-design/SKILL.md` — schema + indexing decisions; mirror existing Drizzle conventions.
- `plan-writing/SKILL.md` — short, specific tasks, verification per phase, file lives at project root.
- `frontend-design/SKILL.md` — primitives reuse, no emoji, sketch aesthetic, motion + reduced-motion compliance.
- `i18n-localization/SKILL.md` — new strings via Paraglide keys in both locales, no hard-coded text.

External research (cited inline above):

- UX Design — *Virtual pet apps and their emotional toll* — https://uxdesign.cc/virtual-pet-apps-and-their-emotional-toll-8c06c5f9e1c (G1)
- r/habitica — *Anyone else get really guilty about…* — https://www.reddit.com/r/habitica/comments/8vu2c5/anyone_else_get_really_guilty_about/ (G1)
- web.dev — *Habit streaks critique / habit-forming UX* — https://web.dev/articles/habit-streaks (G2)
- Gottman Institute — *The Four Horsemen and scorekeeping* — https://www.gottman.com/blog/the-four-horsemen-recognizing-criticism-contempt-defensiveness-and-stonewalling/ (C1)
- Paired science — https://paired.com/articles (C1)
- Postgres docs — *INSERT ON CONFLICT* — https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT (I1, S1)
- Postgres docs — *Advisory locks* — https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS (I1, why we don't use them)
- Cloudflare — *Workers + databases* — https://developers.cloudflare.com/workers/databases/ (I1, P1)
- Supabase docs — *Connecting via pgbouncer* — https://supabase.com/docs/guides/database/connecting-to-postgres#connection-pooling (P1)
- Supabase pricing — Realtime — https://supabase.com/pricing (R1)
- web.dev — *Optimize SVG* — https://web.dev/articles/optimize-svg (A1)
- MDN — *prefers-reduced-motion* — https://developer.mozilla.org/en-US/docs/Web/CSS/@media/prefers-reduced-motion (A1)
- CockroachDB — *Lost update anomaly / optimistic concurrency* — https://www.cockroachlabs.com/docs/stable/transactions.html (I2)
