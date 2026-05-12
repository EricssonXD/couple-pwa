-- 0018 — F8 v2 calendar reminders.
--
-- Per-occurrence reminders for calendar_events. The TS service
-- `calendarReminders.populateForEvent` derives the next 30 days of
-- occurrences (single-occurrence events get just their startsAt;
-- recurring events expand via the same allow-listed RRULE engine the
-- calendar uses) and inserts one row per (occurrence × kind) here.
--
-- The kinds are coarse-grained ("h24" = 24 hours before, "h1" = 1 hour
-- before). `fire_at` is the precomputed wall-clock time the reminder
-- should leave the cron, so the cron query stays a simple range scan
-- on a partial index.
--
-- The atomic "claim due rows + enqueue partner pushes" CTE is wrapped
-- in `app.deliver_due_calendar_reminders()` SECURITY DEFINER, mirrored
-- by the TS service in `services/calendarReminders.ts` (used in dev
-- and as a future per-request flush). Both write to push_outbox with
-- `dedupe_key = 'cal_reminder:' || event_id || ':' || occurrence_at
-- || ':' || kind` so concurrent runs are idempotent.

CREATE TABLE IF NOT EXISTS calendar_reminders (
  event_id      uuid NOT NULL REFERENCES calendar_events(id) ON DELETE CASCADE,
  occurrence_at timestamptz NOT NULL,
  kind          text NOT NULL,
  fire_at       timestamptz NOT NULL,
  sent_at       timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, occurrence_at, kind),
  CONSTRAINT calendar_reminders_kind_chk CHECK (kind IN ('h24', 'h1'))
);

-- Cron query is "WHERE sent_at IS NULL AND fire_at <= now()" — a
-- partial index keeps it tiny (post-send rows fall out of the index).
CREATE INDEX IF NOT EXISTS calendar_reminders_pending_idx
  ON calendar_reminders (fire_at)
  WHERE sent_at IS NULL;

-- RLS: couple members can read their own reminders (useful for an
-- "upcoming reminders" inspector later). Writes are service-role only —
-- the SECURITY DEFINER function below + Drizzle backend cover them.
ALTER TABLE calendar_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_reminders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS calendar_reminders_select ON calendar_reminders;
CREATE POLICY calendar_reminders_select
  ON calendar_reminders
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM calendar_events e
      WHERE e.id = calendar_reminders.event_id
        AND e.couple_id = app.current_couple_id()
    )
  );

-- Atomic claim + outbox enqueue. Mirrors deliver_due_scheduled_notes.
-- Title is derived from the event title; body is the formatted lead
-- ("in 24 hours" / "in 1 hour") so the push surface stays schema-free.
CREATE OR REPLACE FUNCTION app.deliver_due_calendar_reminders(batch_size int DEFAULT 100)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  delivered int;
BEGIN
  WITH due AS (
    UPDATE calendar_reminders r
    SET sent_at = now()
    WHERE (r.event_id, r.occurrence_at, r.kind) IN (
      SELECT event_id, occurrence_at, kind
      FROM calendar_reminders
      WHERE sent_at IS NULL AND fire_at <= now()
      ORDER BY fire_at
      FOR UPDATE SKIP LOCKED
      LIMIT batch_size
    )
    RETURNING r.event_id, r.occurrence_at, r.kind
  ),
  joined AS (
    SELECT
      due.event_id,
      due.occurrence_at,
      due.kind,
      e.couple_id,
      e.title,
      c.partner_a,
      c.partner_b
    FROM due
    JOIN calendar_events e ON e.id = due.event_id
    JOIN couple c ON c.id = e.couple_id
  ),
  fanout AS (
    -- Fan out to BOTH partners: a calendar event affects the couple,
    -- so notify both (unlike scheduled_notes which only notifies the
    -- recipient). The dedupe_key includes the recipient_id implicitly
    -- via the unique index (recipient_id, dedupe_key).
    SELECT couple_id, partner_a AS recipient_id, event_id, occurrence_at, kind, title
    FROM joined
    UNION ALL
    SELECT couple_id, partner_b AS recipient_id, event_id, occurrence_at, kind, title
    FROM joined
  ),
  inserted AS (
    INSERT INTO push_outbox (couple_id, recipient_id, kind, title, body, data_json, dedupe_key)
    SELECT
      f.couple_id,
      f.recipient_id,
      'calendar_reminder',
      f.title,
      CASE f.kind
        WHEN 'h24' THEN 'Reminder: starts in 24 hours'
        WHEN 'h1'  THEN 'Reminder: starts in 1 hour'
        ELSE 'Calendar reminder'
      END,
      json_build_object(
        'eventId', f.event_id,
        'occurrenceAt', f.occurrence_at,
        'kind', f.kind
      )::text,
      'cal_reminder:' || f.event_id || ':' || extract(epoch from f.occurrence_at)::bigint || ':' || f.kind
    FROM fanout f
    ON CONFLICT (recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO delivered FROM inserted;
  RETURN delivered;
END;
$$;

-- Schedule every minute. unschedule-then-schedule keeps the migration
-- idempotent if the cron command body changes between deploys.
SELECT cron.unschedule('deliver-cal-reminders')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deliver-cal-reminders');

SELECT cron.schedule(
  'deliver-cal-reminders',
  '* * * * *',
  $$SELECT app.deliver_due_calendar_reminders(100);$$
);
