-- 0008 — R4 moment last-write-wins.
--
-- Adds an updated_at column to geo_moment so two devices editing the
-- same moment can be reconciled with optimistic concurrency: the client
-- sends the value it last observed, and the server only applies the
-- patch if it still matches. Body edits also bump this column via a
-- trigger so a body-only change still invalidates a stale view.
--
-- The column is NOT NULL with a default of now() so existing rows are
-- backfilled to "now" rather than left null.

ALTER TABLE geo_moment
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION geo_moment_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS geo_moment_touch_updated_at ON geo_moment;
CREATE TRIGGER geo_moment_touch_updated_at
  BEFORE UPDATE ON geo_moment
  FOR EACH ROW EXECUTE FUNCTION geo_moment_touch_updated_at();

-- Body edits should also bump the parent's updated_at so loser-toast
-- detection works even when the visible body changed but no metadata
-- did. This is a separate trigger on geo_moment_body that touches the
-- parent row.
CREATE OR REPLACE FUNCTION geo_moment_body_touch_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE geo_moment SET updated_at = now() WHERE id = NEW.moment_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS geo_moment_body_touch_parent ON geo_moment_body;
CREATE TRIGGER geo_moment_body_touch_parent
  AFTER INSERT OR UPDATE ON geo_moment_body
  FOR EACH ROW EXECUTE FUNCTION geo_moment_body_touch_parent();
