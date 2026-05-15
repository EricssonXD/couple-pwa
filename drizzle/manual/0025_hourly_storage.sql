-- 0025 — Hourly clip Storage bucket + RLS.
--
-- Lives separately from 0025_hourly.sql because Supabase Storage
-- relies on the `storage` extension and `storage.buckets` /
-- `storage.objects` tables which are Supabase-specific. Keeping
-- the schema migration portable lets the Drizzle test suite spin
-- up a vanilla Postgres without flailing on missing extensions.
--
-- Bucket model:
--   - Private bucket `hourly-clips`
--   - File size cap of 750_000 bytes (matches the hourly_clip
--     CHECK constraint in 0025_hourly.sql; 2s WebM at 480p ~200-400KB
--     so this leaves headroom for iOS Safari mp4)
--   - Content-types limited to video/webm and video/mp4
--   - Path layout: {couple_id}/{YYYYMMDDHH}/{user_id}/{attempt_id}.webm
--     (immutable per attempt — no overwrite races; re-record creates a
--     new object and marks the prior hourly_clip row delete_pending)
--
-- Client direct-upload:
--   The Worker never sees the video bytes. Server mints a signed
--   upload URL, browser PUTs directly to Storage, then notifies the
--   server via /api/hourly/finalize so the metadata row can be
--   written and a metadata-only realtime broadcast emitted.
--
-- Idempotent — safe to re-run.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'hourly-clips',
  'hourly-clips',
  false,
  750000,
  ARRAY['video/webm','video/mp4']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ── RLS policies on storage.objects for the hourly-clips bucket ──────
--
-- SELECT: any couple member may read objects whose path's first segment
-- is their couple_id. Signed URLs we mint server-side use the service
-- role and bypass RLS, so this policy is defence-in-depth for any
-- accidental anon-key client read.

DROP POLICY IF EXISTS hourly_clips_select_member ON storage.objects;
CREATE POLICY hourly_clips_select_member ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'hourly-clips'
    AND EXISTS (
      SELECT 1 FROM public.couple c
      WHERE c.id::text = (string_to_array(name, '/'))[1]
        AND (c.partner_a = auth.uid() OR c.partner_b = auth.uid())
    )
  );

-- INSERT/UPDATE/DELETE: deny by default. The server uses the signed
-- upload URL flow (which bypasses object-level RLS), and the purge
-- worker calls Storage.remove with the service role. No client should
-- ever directly insert into this bucket.

DROP POLICY IF EXISTS hourly_clips_insert_deny ON storage.objects;
DROP POLICY IF EXISTS hourly_clips_update_deny ON storage.objects;
DROP POLICY IF EXISTS hourly_clips_delete_deny ON storage.objects;

CREATE POLICY hourly_clips_insert_deny ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id <> 'hourly-clips');

CREATE POLICY hourly_clips_update_deny ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id <> 'hourly-clips');

CREATE POLICY hourly_clips_delete_deny ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id <> 'hourly-clips');
