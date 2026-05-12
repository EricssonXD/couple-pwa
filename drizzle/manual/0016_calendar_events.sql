-- 0016 — F8 Shared calendar (v1).
--
-- Couple-shared events: date nights, anniversaries, travel, etc.
-- v1 ships single-occurrence CRUD. The `rrule` column is reserved
-- for recurring events (v2 will expand via rrule.js). The
-- reminder-cron (24h + 1h push) is also deferred to v2.
--
-- All-day events: `all_day = true`, `starts_at` = midnight UTC of
-- the local day. Time-zone niceties are delegated to the client
-- via Intl APIs (events show in viewer's local tz).

CREATE TABLE IF NOT EXISTS calendar_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id     uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  created_by    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title         text NOT NULL,
  notes         text,
  starts_at     timestamptz NOT NULL,
  ends_at       timestamptz,
  all_day       boolean NOT NULL DEFAULT false,
  rrule         text, -- v2: recurrence (RFC 5545)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT calendar_events_title_len CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT calendar_events_notes_len CHECK (notes IS NULL OR char_length(notes) <= 2000),
  CONSTRAINT calendar_events_ends_after_starts CHECK (ends_at IS NULL OR ends_at >= starts_at)
);

-- Range queries by couple for the calendar view.
CREATE INDEX IF NOT EXISTS calendar_events_couple_starts_idx
  ON calendar_events (couple_id, starts_at);

ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_events_select ON calendar_events;
CREATE POLICY calendar_events_select
  ON calendar_events
  FOR SELECT
  TO authenticated
  USING (couple_id = app.current_couple_id());

DROP POLICY IF EXISTS calendar_events_insert ON calendar_events;
CREATE POLICY calendar_events_insert
  ON calendar_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    couple_id = app.current_couple_id()
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS calendar_events_update ON calendar_events;
CREATE POLICY calendar_events_update
  ON calendar_events
  FOR UPDATE
  TO authenticated
  USING (couple_id = app.current_couple_id())
  WITH CHECK (couple_id = app.current_couple_id());

DROP POLICY IF EXISTS calendar_events_delete ON calendar_events;
CREATE POLICY calendar_events_delete
  ON calendar_events
  FOR DELETE
  TO authenticated
  USING (couple_id = app.current_couple_id());
