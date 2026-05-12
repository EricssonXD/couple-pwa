-- 0017 — F9 "How well do you know me?" quiz runs.
--
-- Newlywed-Game semantics. Each pack has N questions. For every
-- question, BOTH partners record:
--   - self_answer  : what THEY would actually pick (the truth)
--   - guess_answer : what they think their partner would pick
-- Score (per direction) = how many of YOUR guesses matched partner's
-- self_answer. Both directions revealed side-by-side once both done.
--
-- Why no client-readable RLS policy on this table:
--   The columns are asymmetric — leaking partner's self_answers /
--   guess_answers before completed_at = NOT NULL would defeat the
--   reveal mechanic. Bucket-list / calendar can use couple-scoped
--   client RLS because every column is symmetric; quiz_runs cannot.
--   All reads go through SvelteKit (service-role) which projects
--   away partner columns until reveal. Pattern matches push_outbox
--   and audit_log: write-only from the platform's perspective.
--
-- Drafts are persisted (resume-across-devices), not local-only. UI
-- is responsible for not surfacing partner-progress channels (no
-- "partner is on question 4" indicator — anti-coercion / H5).

CREATE TABLE IF NOT EXISTS quiz_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id           uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  quiz_id             text NOT NULL,
  started_by          uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Snapshotted at start so column assignment is stable even if the
  -- couple row is later mutated (e.g. unpair + re-pair).
  a_user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  b_user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- {[questionId]: choiceIndex}. Drafts allowed; null until first write.
  a_self_answers      jsonb,
  a_guess_answers     jsonb,
  b_self_answers      jsonb,
  b_guess_answers     jsonb,
  a_completed_at      timestamptz,
  b_completed_at      timestamptz,
  completed_at        timestamptz,
  abandoned_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quiz_runs_quiz_id_shape
    CHECK (quiz_id ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  CONSTRAINT quiz_runs_partners_distinct
    CHECK (a_user_id <> b_user_id),
  CONSTRAINT quiz_runs_started_by_member
    CHECK (started_by IN (a_user_id, b_user_id)),
  CONSTRAINT quiz_runs_completion_consistent
    CHECK (
      completed_at IS NULL
      OR (a_completed_at IS NOT NULL AND b_completed_at IS NOT NULL)
    ),
  -- Cannot be both completed and abandoned.
  CONSTRAINT quiz_runs_terminal_state
    CHECK (completed_at IS NULL OR abandoned_at IS NULL)
);

-- One open (un-completed, un-abandoned) run per (couple, quiz). Allows
-- unlimited completed history + restart-after-abandon.
CREATE UNIQUE INDEX IF NOT EXISTS quiz_runs_one_open_uq
  ON quiz_runs (couple_id, quiz_id)
  WHERE completed_at IS NULL AND abandoned_at IS NULL;

-- Catalog list ordering: open runs first, then completed by recency,
-- then abandoned. Use DESC NULLS FIRST on completed_at so open runs
-- (NULL) bubble up.
CREATE INDEX IF NOT EXISTS quiz_runs_couple_idx
  ON quiz_runs (couple_id, completed_at DESC NULLS FIRST, created_at DESC);

ALTER TABLE quiz_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE quiz_runs FORCE ROW LEVEL SECURITY;

-- Intentionally no SELECT/INSERT/UPDATE/DELETE policies for the
-- `authenticated` role. Default-deny stops a direct supabase-js
-- query from leaking pre-reveal answers. Service-role (used by
-- SvelteKit) bypasses RLS and is the only writer/reader.
