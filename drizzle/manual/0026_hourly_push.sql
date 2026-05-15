-- 0026 — F11 hourly push reminders.
--
-- Fires once at the top of every hour (minute 2 to give clip-attempt
-- TTL purge breathing room). For every paired user whose configured
-- waking window (in their tz) covers the *current local hour* AND who
-- has not yet captured a clip for the current UTC hour bucket, enqueues
-- a single push into push_outbox with dedupe key
--
--   'hourly:' || user_id || ':' || hour_bucket_iso
--
-- so concurrent runs are idempotent. Users without a hourly_push_window
-- row are NOT enqueued — opt-in by visiting Settings.
--
-- The reminder text is inert ("Capture your hour"). The Worker that
-- delivers push_outbox already handles tz-respectful delivery via web
-- push / FCM.

CREATE OR REPLACE FUNCTION app.enqueue_hourly_capture_reminders()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  enqueued int;
  bucket    timestamptz := date_trunc('hour', now());
  bucket_iso text := to_char(bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:00:00"Z"');
BEGIN
  WITH candidates AS (
    SELECT
      w.user_id,
      c.id AS couple_id,
      EXTRACT(HOUR FROM (now() AT TIME ZONE w.tz))::int AS local_hour,
      w.start_hour,
      w.end_hour
    FROM hourly_push_window w
    JOIN couple c
      ON (c.partner_a = w.user_id OR c.partner_b = w.user_id)
     AND c.status = 'active'
  ),
  in_window AS (
    SELECT user_id, couple_id
    FROM candidates
    WHERE
      (start_hour <= end_hour AND local_hour BETWEEN start_hour AND end_hour)
      OR
      (start_hour >  end_hour AND (local_hour >= start_hour OR local_hour <= end_hour))
  ),
  needs_reminder AS (
    SELECT iw.user_id, iw.couple_id
    FROM in_window iw
    WHERE NOT EXISTS (
      SELECT 1 FROM hourly_clip hc
      WHERE hc.user_id     = iw.user_id
        AND hc.couple_id   = iw.couple_id
        AND hc.hour_bucket = bucket
        AND hc.status      = 'ready'
    )
  ),
  inserted AS (
    INSERT INTO push_outbox (couple_id, recipient_id, kind, title, body, data_json, dedupe_key)
    SELECT
      nr.couple_id,
      nr.user_id,
      'hourly_reminder',
      'Capture your hour',
      'A 2-second clip — share what you''re doing right now.',
      json_build_object('hourBucket', bucket_iso)::text,
      'hourly:' || nr.user_id::text || ':' || bucket_iso
    FROM needs_reminder nr
    ON CONFLICT (recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO enqueued FROM inserted;
  RETURN COALESCE(enqueued, 0);
END;
$$;

REVOKE ALL ON FUNCTION app.enqueue_hourly_capture_reminders() FROM PUBLIC;

-- ── pg_cron schedule (idempotent) ────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hourly-capture-reminder') THEN
    PERFORM cron.unschedule('hourly-capture-reminder');
  END IF;
END $$;

SELECT cron.schedule(
  'hourly-capture-reminder',
  '2 * * * *',
  $$SELECT app.enqueue_hourly_capture_reminders()$$
);
