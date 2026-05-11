-- 0011 — H5 audit log.
--
-- Append-only ledger of safety-relevant actions a user takes on
-- themselves. Used to surface "who paused/resumed sharing when" so
-- a coerced partner has receipts and so the user has a transparent
-- history of their own privacy actions.
--
-- Deliberately scoped to the *acting user only*: the partner cannot
-- read the log (otherwise the partner could verify whether the user
-- has been "good", which defeats anti-coercion). Service role writes
-- on behalf of users; users SELECT only their own rows.

CREATE TABLE IF NOT EXISTS audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action      text NOT NULL,
  metadata    jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_user_idx
  ON audit_log (user_id, created_at DESC);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

-- The acting user can read their own log.
CREATE POLICY audit_log_select_own
  ON audit_log
  FOR SELECT
  USING (user_id = auth.uid());

-- Inserts go through the server (service role bypasses RLS); deny
-- direct INSERT / UPDATE / DELETE from end-user contexts. No write
-- policies = no client writes.
