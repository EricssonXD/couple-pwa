-- 0007 — H4 account deletion (7-day soft delete).
--
-- We never push a hard auth.users delete from the app server (no service
-- role key in Workers). Instead, profile.pending_deletion_at marks the
-- soft-delete window. Hooks gate every request: when the timestamp lies
-- in the past, the session is cleared and the row carries a tombstone
-- the operator can purge with a separate scheduled job.

ALTER TABLE profile
  ADD COLUMN IF NOT EXISTS pending_deletion_at timestamptz;

CREATE INDEX IF NOT EXISTS profile_pending_deletion_idx
  ON profile (pending_deletion_at)
  WHERE pending_deletion_at IS NOT NULL;
