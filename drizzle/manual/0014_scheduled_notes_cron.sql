-- 0014 — F3 Time-capsule cron delivery.
--
-- Encapsulates the atomic "claim due rows + enqueue partner pushes" CTE
-- as a SECURITY DEFINER function so pg_cron can call it directly with
-- no Edge Function in the loop. Idempotent across retries via the
-- push_outbox dedupe_key.
--
-- The TS service `services/scheduledNotes.ts` keeps its own copy of the
-- CTE (used in dev / local cron / future per-request flush). Both paths
-- write to push_outbox with `dedupe_key = 'scheduled_note:' || id`, so
-- they're safe to run concurrently.

CREATE OR REPLACE FUNCTION app.deliver_due_scheduled_notes(batch_size int DEFAULT 100)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  delivered int;
BEGIN
  WITH due AS (
    UPDATE scheduled_notes
    SET delivered_at = now()
    WHERE id IN (
      SELECT id FROM scheduled_notes
      WHERE delivered_at IS NULL AND deliver_at <= now()
      ORDER BY deliver_at
      FOR UPDATE SKIP LOCKED
      LIMIT batch_size
    )
    RETURNING id, couple_id, author_id, body
  ),
  recipient AS (
    SELECT due.id AS note_id,
           due.couple_id,
           due.author_id,
           due.body,
           CASE
             WHEN c.partner_a = due.author_id THEN c.partner_b
             ELSE c.partner_a
           END AS recipient_id
    FROM due
    JOIN couple c ON c.id = due.couple_id
  ),
  inserted AS (
    INSERT INTO push_outbox (couple_id, recipient_id, kind, title, body, data_json, dedupe_key)
    SELECT
      r.couple_id,
      r.recipient_id,
      'scheduled_note',
      COALESCE(p.display_name, '💌') || ' sent you a time capsule',
      substring(r.body FROM 1 FOR 140),
      json_build_object('noteId', r.note_id)::text,
      'scheduled_note:' || r.note_id
    FROM recipient r
    LEFT JOIN profile p ON p.user_id = r.author_id
    ON CONFLICT (recipient_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO delivered FROM inserted;
  RETURN delivered;
END;
$$;

-- Schedule every minute. Idempotent — schedule() re-creates if it
-- already exists with a different command.
SELECT cron.unschedule('deliver-notes')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'deliver-notes');

SELECT cron.schedule(
  'deliver-notes',
  '* * * * *',
  $$SELECT app.deliver_due_scheduled_notes(100);$$
);
