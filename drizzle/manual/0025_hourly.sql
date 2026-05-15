-- 0025 — F11 Hourly diary (clip + mood + push window).
--
-- A private real-time visual diary. Each user can record one 2-second
-- camera-only video per hour, and set an hourly mood emoji. Both
-- partners see the full day side-by-side. Clips TTL after 2 days; mood
-- persists indefinitely (but is hidden from the partner after 24h).
--
-- ── Tables ───────────────────────────────────────────────────────────
--   hourly_clip_attempt  — server-issued upload tracker. Holds the
--                          immutable storage_key for an in-flight upload
--                          so finalize() can re-validate the time window
--                          and the storage object before promoting the
--                          attempt to a hourly_clip row. Ephemeral.
--   hourly_clip          — finalized clip metadata + lifecycle status.
--                          UNIQUE(couple, user, hour_bucket) WHERE
--                          status='ready' so re-record marks the prior
--                          row 'delete_pending' (purge worker removes
--                          the storage object then hard-deletes).
--   hourly_mood          — 5-emoji hourly bucket. Mood persists, but
--                          the partner can only SELECT rows ≤24h old
--                          (mirrors mood_pulse anti-coercion stance).
--   hourly_push_window   — per-user waking window for hourly reminder
--                          push notifications.
--
-- Storage bucket creation + Storage RLS lives in
-- 0025_hourly_storage.sql so this file stays SQL-portable across
-- non-Supabase Postgres environments.

CREATE TABLE IF NOT EXISTS hourly_clip_attempt (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id    uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hour_bucket  timestamptz NOT NULL,
  storage_key  text NOT NULL,
  expires_at   timestamptz NOT NULL,
  finalized_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (date_trunc('hour', hour_bucket) = hour_bucket),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS hourly_clip_attempt_expiry_idx
  ON hourly_clip_attempt (expires_at)
  WHERE finalized_at IS NULL;

ALTER TABLE hourly_clip_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE hourly_clip_attempt FORCE ROW LEVEL SECURITY;
-- Server-only table — no policies = no client read/write.

CREATE TABLE IF NOT EXISTS hourly_clip (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id    uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hour_bucket  timestamptz NOT NULL,
  storage_key  text NOT NULL,
  mime         text NOT NULL,
  byte_size    integer NOT NULL,
  status       text NOT NULL DEFAULT 'ready',
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (date_trunc('hour', hour_bucket) = hour_bucket),
  CHECK (status IN ('ready','delete_pending','deleted')),
  CHECK (byte_size > 0 AND byte_size <= 750000),
  CHECK (mime IN ('video/webm','video/mp4'))
);

-- Only ONE ready clip per (couple, user, hour). Re-record promotes a
-- new attempt to 'ready' and demotes the prior to 'delete_pending'.
CREATE UNIQUE INDEX IF NOT EXISTS hourly_clip_one_ready_per_hour_uq
  ON hourly_clip (couple_id, user_id, hour_bucket)
  WHERE status = 'ready';

CREATE INDEX IF NOT EXISTS hourly_clip_couple_hour_idx
  ON hourly_clip (couple_id, hour_bucket DESC)
  WHERE status = 'ready';

CREATE INDEX IF NOT EXISTS hourly_clip_purge_idx
  ON hourly_clip (created_at)
  WHERE status IN ('ready','delete_pending');

ALTER TABLE hourly_clip ENABLE ROW LEVEL SECURITY;
ALTER TABLE hourly_clip FORCE ROW LEVEL SECURITY;

-- SELECT: any couple member can read READY clips for their couple AND
-- only within the 2-day retention window (defence-in-depth so even if
-- the purge worker stalls, expired clips disappear from clients).
DROP POLICY IF EXISTS hourly_clip_select_member ON hourly_clip;
CREATE POLICY hourly_clip_select_member ON hourly_clip
  FOR SELECT
  USING (
    status = 'ready'
    AND created_at >= now() - interval '2 days'
    AND EXISTS (
      SELECT 1 FROM couple c
      WHERE c.id = hourly_clip.couple_id
        AND (c.partner_a = auth.uid() OR c.partner_b = auth.uid())
    )
  );

-- No INSERT/UPDATE/DELETE policies: all writes go through the server
-- (Drizzle bypasses RLS). Direct supabase-js writes are denied.

CREATE TABLE IF NOT EXISTS hourly_mood (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id    uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hour_bucket  timestamptz NOT NULL,
  mood         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (couple_id, user_id, hour_bucket),
  CHECK (date_trunc('hour', hour_bucket) = hour_bucket),
  CHECK (mood IN ('joyful','happy','neutral','sad','upset'))
);

CREATE INDEX IF NOT EXISTS hourly_mood_couple_hour_idx
  ON hourly_mood (couple_id, hour_bucket DESC);

ALTER TABLE hourly_mood ENABLE ROW LEVEL SECURITY;
ALTER TABLE hourly_mood FORCE ROW LEVEL SECURITY;

-- SELECT: own rows always; partner's rows only if ≤24h old. This
-- preserves the mood_pulse anti-coercion principle — historical
-- emotional state cannot be timeline-analysed by a coercive partner.
-- The diary surface only ever needs the live day so this restriction
-- is product-aligned.
DROP POLICY IF EXISTS hourly_mood_select_own_or_recent ON hourly_mood;
CREATE POLICY hourly_mood_select_own_or_recent ON hourly_mood
  FOR SELECT
  USING (
    user_id = auth.uid()
    OR (
      created_at >= now() - interval '24 hours'
      AND EXISTS (
        SELECT 1 FROM couple c
        WHERE c.id = hourly_mood.couple_id
          AND (c.partner_a = auth.uid() OR c.partner_b = auth.uid())
      )
    )
  );

-- Server-only writes.

CREATE TABLE IF NOT EXISTS hourly_push_window (
  user_id     uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  start_hour  smallint NOT NULL DEFAULT 9,
  end_hour    smallint NOT NULL DEFAULT 22,
  tz          text NOT NULL DEFAULT 'UTC',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (start_hour >= 0 AND start_hour <= 23),
  CHECK (end_hour   >= 0 AND end_hour   <= 23)
);

ALTER TABLE hourly_push_window ENABLE ROW LEVEL SECURITY;
ALTER TABLE hourly_push_window FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hourly_push_window_select_own ON hourly_push_window;
CREATE POLICY hourly_push_window_select_own ON hourly_push_window
  FOR SELECT
  USING (user_id = auth.uid());

-- Server-only INSERT/UPDATE.

-- ── Cron: enqueue expired clips for purge ────────────────────────────
-- Marks ready clips older than 2 days as delete_pending. A separate
-- worker (called from the app, not pg_cron) drains the delete_pending
-- queue by removing the storage objects and hard-deleting rows. This
-- two-phase approach avoids orphaned storage objects when the storage
-- API delete call fails (which Postgres alone cannot guarantee).

CREATE OR REPLACE FUNCTION app.enqueue_expired_hourly_clips()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  marked int;
BEGIN
  WITH updated AS (
    UPDATE hourly_clip
    SET status = 'delete_pending'
    WHERE status = 'ready'
      AND created_at < now() - interval '2 days'
    RETURNING id
  )
  SELECT count(*) INTO marked FROM updated;
  RETURN COALESCE(marked, 0);
END;
$$;

REVOKE ALL ON FUNCTION app.enqueue_expired_hourly_clips() FROM PUBLIC;

-- ── Cron: prune unfinalized upload attempts ──────────────────────────
-- Attempts hold a storage_key but the storage object may or may not
-- exist (client could have abandoned the upload). The TTL-purge worker
-- attempts a Storage remove on the key regardless (idempotent), then
-- hard-deletes the attempt row.

CREATE OR REPLACE FUNCTION app.purge_stale_hourly_clip_attempts()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, app
AS $$
DECLARE
  purged int;
BEGIN
  WITH deleted AS (
    DELETE FROM hourly_clip_attempt
    WHERE finalized_at IS NULL
      AND expires_at < now() - interval '15 minutes'
    RETURNING id
  )
  SELECT count(*) INTO purged FROM deleted;
  RETURN COALESCE(purged, 0);
END;
$$;

REVOKE ALL ON FUNCTION app.purge_stale_hourly_clip_attempts() FROM PUBLIC;

-- ── pg_cron schedules (idempotent) ───────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hourly-clip-enqueue-expired') THEN
    PERFORM cron.unschedule('hourly-clip-enqueue-expired');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hourly-clip-attempt-purge') THEN
    PERFORM cron.unschedule('hourly-clip-attempt-purge');
  END IF;
END $$;

SELECT cron.schedule(
  'hourly-clip-enqueue-expired',
  '7 * * * *',
  $$SELECT app.enqueue_expired_hourly_clips()$$
);

SELECT cron.schedule(
  'hourly-clip-attempt-purge',
  '17 * * * *',
  $$SELECT app.purge_stale_hourly_clip_attempts()$$
);
