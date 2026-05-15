-- 0023 — Pet buffs (Phase 5).
--
-- Adds the `pet_buff` table that backs the temporary multiplier buffs
-- (`buff_doublecoin`, `buff_xpboost`) sold in the shop since 0022 with
-- `enabled = false`. This migration:
--   • creates `pet_buff` (couple_id, kind, multiplier, active_until)
--     with a unique index on (couple_id, kind) so activating the same
--     buff twice EXTENDS the active_until rather than stacking
--     multipliers (cap is also enforced in service code at ×2.0);
--   • flips `enabled = true` on `buff_doublecoin` AND `buff_xpboost` so
--     the shop now surfaces them. Spec §6 W3.
--   • RLS policies match the rest of the pet tables — couple members
--     can SELECT; writes go through the service-role backend.
--
-- Note: `buff_xpboost` is shippable but v1 has no XP system, so the
-- service layer refuses activation with a "not available yet" message.
-- The shop row stays enabled so the seed reflects the canonical price
-- list; the refusal lives in code, not in the DB. (User decision —
-- session 67f7241a, plan.md decision 2.)
--
-- Idempotent: every CREATE uses IF NOT EXISTS, every policy is dropped
-- first then recreated, the seed update uses ON CONFLICT DO UPDATE.

-- ─── 1. pet_buff ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS pet_buff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  kind text NOT NULL,
  multiplier numeric(3,2) NOT NULL,
  active_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pet_buff_couple_kind_uq
  ON pet_buff (couple_id, kind);

CREATE INDEX IF NOT EXISTS pet_buff_active_until_idx
  ON pet_buff (active_until);

ALTER TABLE pet_buff
  DROP CONSTRAINT IF EXISTS pet_buff_kind_chk;
ALTER TABLE pet_buff
  ADD CONSTRAINT pet_buff_kind_chk CHECK (kind IN ('coin','xp'));

ALTER TABLE pet_buff
  DROP CONSTRAINT IF EXISTS pet_buff_multiplier_chk;
ALTER TABLE pet_buff
  ADD CONSTRAINT pet_buff_multiplier_chk CHECK (multiplier > 1.0 AND multiplier <= 2.0);

ALTER TABLE pet_buff ENABLE ROW LEVEL SECURITY;
ALTER TABLE pet_buff FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pet_buff_select_member ON pet_buff;
CREATE POLICY pet_buff_select_member ON pet_buff
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM couple c
      WHERE c.id = pet_buff.couple_id
        AND (c.partner_a = auth.uid() OR c.partner_b = auth.uid())
    )
  );

-- ─── 2. Flip buff shop rows live ─────────────────────────────────────────

UPDATE pet_shop_item
SET enabled = true
WHERE id IN ('buff_doublecoin', 'buff_xpboost');
