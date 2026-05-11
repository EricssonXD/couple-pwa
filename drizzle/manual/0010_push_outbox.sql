-- 0010 — N2 push outbox.
--
-- Append-only queue feeding the N3 delivery worker. Insert path is the
-- service layer (location.recordPing, moments.createMoment); read +
-- delete is the delivery worker via service-role. RLS denies all
-- end-user access — outbox rows leak partner activity timing if a
-- client could query them directly.

CREATE TABLE IF NOT EXISTS push_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id     uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  recipient_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  kind          text NOT NULL,
  title         text NOT NULL,
  body          text NOT NULL,
  data_json     text,
  dedupe_key    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  delivered_at  timestamptz,
  attempts      integer NOT NULL DEFAULT 0,
  last_error    text
);

CREATE INDEX IF NOT EXISTS push_outbox_pending_idx
  ON push_outbox (created_at)
  WHERE delivered_at IS NULL;

-- Partial unique on (recipient, dedupe_key) so the *application* can
-- skip re-inserting the same logical event in a short window. NULLs
-- are excluded — events without a dedupe key always insert.
CREATE UNIQUE INDEX IF NOT EXISTS push_outbox_dedupe_idx
  ON push_outbox (recipient_id, dedupe_key)
  WHERE dedupe_key IS NOT NULL;

ALTER TABLE push_outbox ENABLE ROW LEVEL SECURITY;
-- No policies = nobody can SELECT/INSERT/UPDATE/DELETE except via
-- the service role (bypasses RLS).
