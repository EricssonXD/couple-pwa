-- 0022 — Shared virtual-pet system (Phase 1).
--
-- Adds five tables (`pet`, `pet_wallet`, `pet_ledger`, `pet_shop_item`,
-- `pet_inventory`) plus the v1 shop seed. RLS on all five — defence in
-- depth on top of the service-role backend that already bypasses RLS.
--
-- See `pet-system.md` for the full design (concurrency model, decay
-- formula, earn pipeline, broadcast strategy). Key invariants enforced
-- at the DB layer:
--   • pet.version / pet_wallet.version → optimistic concurrency (I2)
--   • pet_ledger partial unique on (couple_id, dedupe_key) WHERE
--     dedupe_key IS NOT NULL → at-least-once safety (I1)
--   • pet_inventory partial unique on (couple_id, slot) WHERE
--     equipped AND slot IS NOT NULL → "one equipped per slot" (W6).
--     `slot` is denormalized onto the inventory row at insert time
--     so the constraint can be a single partial index — Postgres
--     cannot enforce a joined partial index across tables.
--   • Decay floors (mood ≥ 20, hunger ≤ 80) are checked in service
--     code, NOT in DB — admins/migrations must be free to override.
--   • Buffs (`buff_*` shop items) ship with `enabled = false`. Phase 5
--     migration `0023_pet_buffs.sql` flips them on (W3).
--
-- Idempotent: every CREATE uses IF NOT EXISTS, every seed uses
-- ON CONFLICT DO UPDATE, every policy is dropped first then recreated.

-- ─── 1. pet ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pet (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  species text NOT NULL,
  name text NOT NULL,
  stage text NOT NULL DEFAULT 'egg',
  xp integer NOT NULL DEFAULT 0,
  mood integer NOT NULL DEFAULT 80,
  hunger integer NOT NULL DEFAULT 20,
  mood_updated_at timestamptz NOT NULL DEFAULT now(),
  hunger_updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 0,
  hatched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pet_species_chk CHECK (species IN ('fox','cat','bird','capybara')),
  CONSTRAINT pet_stage_chk   CHECK (stage   IN ('egg','baby','grown')),
  CONSTRAINT pet_xp_chk      CHECK (xp >= 0),
  CONSTRAINT pet_mood_chk    CHECK (mood   BETWEEN 0 AND 100),
  CONSTRAINT pet_hunger_chk  CHECK (hunger BETWEEN 0 AND 100),
  CONSTRAINT pet_name_len_chk CHECK (char_length(name) BETWEEN 1 AND 24)
);

CREATE UNIQUE INDEX IF NOT EXISTS pet_couple_uq ON pet (couple_id);

ALTER TABLE pet ENABLE ROW LEVEL SECURITY;
ALTER TABLE pet FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pet_select_member ON pet;
CREATE POLICY pet_select_member ON pet
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM couple c
      WHERE c.id = pet.couple_id
        AND (c.partner_a = auth.uid() OR c.partner_b = auth.uid())
    )
  );

-- No INSERT/UPDATE/DELETE policies for clients — all writes flow
-- through the service-role backend (`pet.ts` service module).

-- ─── 2. pet_wallet ───────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pet_wallet (
  couple_id uuid PRIMARY KEY REFERENCES couple(id) ON DELETE CASCADE,
  coins integer NOT NULL DEFAULT 0,
  lifetime_earned integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pet_wallet_coins_chk CHECK (coins >= 0)
);

ALTER TABLE pet_wallet ENABLE ROW LEVEL SECURITY;
ALTER TABLE pet_wallet FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pet_wallet_select_member ON pet_wallet;
CREATE POLICY pet_wallet_select_member ON pet_wallet
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM couple c
      WHERE c.id = pet_wallet.couple_id
        AND (c.partner_a = auth.uid() OR c.partner_b = auth.uid())
    )
  );

-- ─── 3. pet_ledger ───────────────────────────────────────────────────────
-- Append-only audit + dedupe.

CREATE TABLE IF NOT EXISTS pet_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  kind text NOT NULL,
  source text NOT NULL,
  coins_delta integer NOT NULL,
  xp_delta integer NOT NULL DEFAULT 0,
  dedupe_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pet_ledger_kind_chk CHECK (kind IN ('earn','spend','adjust'))
);

-- Partial unique — NULL dedupe_key rows skip the constraint (intentional
-- non-deduped grants like admin adjustments).
CREATE UNIQUE INDEX IF NOT EXISTS pet_ledger_dedupe_uq
  ON pet_ledger (couple_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS pet_ledger_couple_created_idx
  ON pet_ledger (couple_id, created_at DESC);

ALTER TABLE pet_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE pet_ledger FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pet_ledger_select_member ON pet_ledger;
CREATE POLICY pet_ledger_select_member ON pet_ledger
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM couple c
      WHERE c.id = pet_ledger.couple_id
        AND (c.partner_a = auth.uid() OR c.partner_b = auth.uid())
    )
  );

-- ─── 4. pet_shop_item ────────────────────────────────────────────────────
-- Catalogue. Public-readable so unauthenticated marketing pages could
-- preview prices in the future; row count is tiny.

CREATE TABLE IF NOT EXISTS pet_shop_item (
  id text PRIMARY KEY,
  kind text NOT NULL,
  slot text,
  name_key text NOT NULL,
  description_key text NOT NULL,
  price_coins integer NOT NULL,
  min_stage text NOT NULL DEFAULT 'egg',
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  CONSTRAINT pet_shop_item_kind_chk      CHECK (kind     IN ('cosmetic','treat','furniture','buff')),
  CONSTRAINT pet_shop_item_min_stage_chk CHECK (min_stage IN ('egg','baby','grown')),
  CONSTRAINT pet_shop_item_price_chk     CHECK (price_coins >= 0)
);

ALTER TABLE pet_shop_item ENABLE ROW LEVEL SECURITY;
ALTER TABLE pet_shop_item FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pet_shop_item_select_all ON pet_shop_item;
CREATE POLICY pet_shop_item_select_all ON pet_shop_item
  FOR SELECT USING (enabled = true);

-- ─── 5. pet_inventory ────────────────────────────────────────────────────
-- Per-couple ownership. `slot` is denormalized from pet_shop_item so the
-- "one equipped per (couple, slot)" partial unique index can be enforced
-- without a cross-table trigger (W6).

CREATE TABLE IF NOT EXISTS pet_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES pet_shop_item(id),
  slot text,
  qty integer NOT NULL DEFAULT 1,
  equipped boolean NOT NULL DEFAULT false,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pet_inventory_qty_chk CHECK (qty >= 0)
);

CREATE INDEX IF NOT EXISTS pet_inventory_couple_idx ON pet_inventory (couple_id);

CREATE UNIQUE INDEX IF NOT EXISTS pet_inventory_couple_item_uq
  ON pet_inventory (couple_id, item_id);

CREATE UNIQUE INDEX IF NOT EXISTS pet_inventory_equipped_slot_uq
  ON pet_inventory (couple_id, slot)
  WHERE equipped AND slot IS NOT NULL;

ALTER TABLE pet_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE pet_inventory FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pet_inventory_select_member ON pet_inventory;
CREATE POLICY pet_inventory_select_member ON pet_inventory
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM couple c
      WHERE c.id = pet_inventory.couple_id
        AND (c.partner_a = auth.uid() OR c.partner_b = auth.uid())
    )
  );

-- ─── Shop seed (P1.2) ────────────────────────────────────────────────────
-- 12 v1 items. ON CONFLICT DO UPDATE makes this re-runnable and lets
-- future migrations re-balance prices by re-running this statement.
-- Buff rows ship `enabled = false` until Phase 5 (W3).

INSERT INTO pet_shop_item (id, kind, slot, name_key, description_key, price_coins, min_stage, enabled, sort_order)
VALUES
  ('hat_paper_crown',  'cosmetic',  'hat',        'shop_item_hat_paper_crown_name',  'shop_item_hat_paper_crown_desc',   30,  'baby',  true,  10),
  ('hat_beanie',       'cosmetic',  'hat',        'shop_item_hat_beanie_name',       'shop_item_hat_beanie_desc',        60,  'baby',  true,  20),
  ('scarf_red',        'cosmetic',  'scarf',      'shop_item_scarf_red_name',        'shop_item_scarf_red_desc',         50,  'baby',  true,  30),
  ('scarf_dotted',     'cosmetic',  'scarf',      'shop_item_scarf_dotted_name',     'shop_item_scarf_dotted_desc',      90,  'grown', true,  40),
  ('expr_sleepy',      'cosmetic',  'expression', 'shop_item_expr_sleepy_name',      'shop_item_expr_sleepy_desc',       80,  'grown', true,  50),
  ('treat_strawberry', 'treat',     NULL,         'shop_item_treat_strawberry_name', 'shop_item_treat_strawberry_desc',  10,  'egg',   true,  60),
  ('treat_dumpling',   'treat',     NULL,         'shop_item_treat_dumpling_name',   'shop_item_treat_dumpling_desc',    20,  'baby',  true,  70),
  ('treat_cake',       'treat',     NULL,         'shop_item_treat_cake_name',       'shop_item_treat_cake_desc',        35,  'grown', true,  80),
  ('furn_rug',         'furniture', NULL,         'shop_item_furn_rug_name',         'shop_item_furn_rug_desc',          80,  'baby',  true,  90),
  ('furn_window',      'furniture', NULL,         'shop_item_furn_window_name',      'shop_item_furn_window_desc',      140,  'grown', true, 100),
  -- Buffs disabled until Phase 5 ships the petBuff table + multiplier (W3).
  ('buff_doublecoin',  'buff',      NULL,         'shop_item_buff_doublecoin_name',  'shop_item_buff_doublecoin_desc',   50,  'baby',  false, 110),
  ('buff_xpboost',     'buff',      NULL,         'shop_item_buff_xpboost_name',     'shop_item_buff_xpboost_desc',      70,  'grown', false, 120)
ON CONFLICT (id) DO UPDATE SET
  kind            = EXCLUDED.kind,
  slot            = EXCLUDED.slot,
  name_key        = EXCLUDED.name_key,
  description_key = EXCLUDED.description_key,
  price_coins     = EXCLUDED.price_coins,
  min_stage       = EXCLUDED.min_stage,
  enabled         = EXCLUDED.enabled,
  sort_order      = EXCLUDED.sort_order;
