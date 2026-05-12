-- 0021 — F7 chat-message TTL purge.
--
-- Hard delete chat_messages older than 7 days. Runs hourly. Mirror of
-- the scheduled-notes cron (0014) — wrapped in a SECURITY DEFINER
-- function so pg_cron can call it without superuser RLS shenanigans.
--
-- Idempotent: re-running just deletes any newly-expired rows.

CREATE OR REPLACE FUNCTION app.purge_expired_chat_messages()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  purged int;
BEGIN
  WITH deleted AS (
    DELETE FROM chat_messages
    WHERE created_at < now() - interval '7 days'
    RETURNING id
  )
  SELECT count(*) INTO purged FROM deleted;
  RETURN COALESCE(purged, 0);
END;
$$;

REVOKE ALL ON FUNCTION app.purge_expired_chat_messages() FROM PUBLIC;

-- Idempotent (re-)schedule: unschedule first if the job already exists,
-- then reschedule. Mirrors 0014_scheduled_notes_cron.sql so re-running
-- this migration on an env that's already provisioned doesn't blow up
-- with "job already exists".
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'chat-purge') THEN
    PERFORM cron.unschedule('chat-purge');
  END IF;
END $$;

SELECT cron.schedule(
  'chat-purge',
  '0 * * * *',
  $$SELECT app.purge_expired_chat_messages()$$
);
