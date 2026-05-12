-- 0013 — F3 Time-capsule scheduled notes.
--
-- An author writes a private note for their partner that is hidden
-- until `deliver_at`. A cron worker (couple-pwa-cron) pings the
-- internal endpoint every 15 minutes and the SvelteKit Worker drains
-- due rows in a single transaction (UPDATE ... RETURNING into INSERT
-- INTO push_outbox), so a delivery either fully completes or rolls
-- back — never half-delivers.
--
-- Anti-surprise-leak posture (rubber-duck #10): the partner cannot
-- see *anything* about a scheduled note until delivery — not its
-- existence, not its scheduled time. Only the author sees their own
-- pending notes. Once delivered, both partners can read it.

CREATE TABLE IF NOT EXISTS scheduled_notes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id     uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  author_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body          text NOT NULL,
  deliver_at    timestamptz NOT NULL,
  delivered_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scheduled_notes_body_len CHECK (char_length(body) BETWEEN 1 AND 2000),
  CONSTRAINT scheduled_notes_deliver_future CHECK (deliver_at > created_at)
);

-- Author's own list (pending + delivered) ordered by deliver_at.
CREATE INDEX IF NOT EXISTS scheduled_notes_author_idx
  ON scheduled_notes (author_id, deliver_at DESC);

-- Couple's delivered feed.
CREATE INDEX IF NOT EXISTS scheduled_notes_couple_delivered_idx
  ON scheduled_notes (couple_id, delivered_at DESC)
  WHERE delivered_at IS NOT NULL;

-- Hot path for the cron sweep — only undelivered, ordered for SKIP
-- LOCKED. The partial index keeps it tiny since most rows graduate
-- to delivered_at IS NOT NULL.
CREATE INDEX IF NOT EXISTS scheduled_notes_due_idx
  ON scheduled_notes (deliver_at)
  WHERE delivered_at IS NULL;

ALTER TABLE scheduled_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_notes FORCE ROW LEVEL SECURITY;

-- Author always sees their own; partner sees only after delivery.
DROP POLICY IF EXISTS scheduled_notes_select ON scheduled_notes;
CREATE POLICY scheduled_notes_select
  ON scheduled_notes
  FOR SELECT
  TO authenticated
  USING (
    author_id = auth.uid()
    OR (couple_id = app.current_couple_id() AND delivered_at IS NOT NULL)
  );

-- Author can create only as themselves and only inside their own couple.
DROP POLICY IF EXISTS scheduled_notes_insert ON scheduled_notes;
CREATE POLICY scheduled_notes_insert
  ON scheduled_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_id = auth.uid()
    AND couple_id = app.current_couple_id()
  );

-- Author can cancel only their own undelivered notes.
DROP POLICY IF EXISTS scheduled_notes_delete ON scheduled_notes;
CREATE POLICY scheduled_notes_delete
  ON scheduled_notes
  FOR DELETE
  TO authenticated
  USING (
    author_id = auth.uid()
    AND delivered_at IS NULL
  );

-- No UPDATE policy — delivered_at is flipped only by the cron via
-- the service-role Drizzle client.
