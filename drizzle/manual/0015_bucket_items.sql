-- 0015 — F6 Shared bucket list.
--
-- Couple-shared "things we want to do together" list. Either partner
-- can create, edit, mark done, or delete any item in their couple.
-- target_date is a soft optional anchor; done_at + done_by record the
-- celebrating moment.
--
-- RLS: full couple-scoped CRUD. No surprise-leak posture (unlike F3
-- scheduled notes) — this is meant to be visible and collaborative.

CREATE TABLE IF NOT EXISTS bucket_items (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id     uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         text NOT NULL,
  notes         text,
  target_date   date,
  done_at       timestamptz,
  done_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bucket_items_title_len CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT bucket_items_notes_len CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CONSTRAINT bucket_items_done_pair CHECK ((done_at IS NULL) = (done_by IS NULL))
);

-- Couple's primary list view: pending first (done_at NULL), then by created.
CREATE INDEX IF NOT EXISTS bucket_items_couple_idx
  ON bucket_items (couple_id, done_at NULLS FIRST, created_at DESC);

ALTER TABLE bucket_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE bucket_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS bucket_items_select ON bucket_items;
CREATE POLICY bucket_items_select
  ON bucket_items
  FOR SELECT
  TO authenticated
  USING (couple_id = app.current_couple_id());

DROP POLICY IF EXISTS bucket_items_insert ON bucket_items;
CREATE POLICY bucket_items_insert
  ON bucket_items
  FOR INSERT
  TO authenticated
  WITH CHECK (
    couple_id = app.current_couple_id()
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS bucket_items_update ON bucket_items;
CREATE POLICY bucket_items_update
  ON bucket_items
  FOR UPDATE
  TO authenticated
  USING (couple_id = app.current_couple_id())
  WITH CHECK (couple_id = app.current_couple_id());

DROP POLICY IF EXISTS bucket_items_delete ON bucket_items;
CREATE POLICY bucket_items_delete
  ON bucket_items
  FOR DELETE
  TO authenticated
  USING (couple_id = app.current_couple_id());
