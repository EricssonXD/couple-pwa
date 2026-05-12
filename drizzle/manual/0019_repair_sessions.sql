-- 0019 — F16 Repair sessions (post-conflict cooldown + reflection).
--
-- A "repair session" is a structured way for either partner to flag
-- "we had a fight, let's cool off and reconnect." Lifecycle:
--
--   1. Either partner POSTs /api/repair → row created, status='cooldown',
--      cool_off_until set. Partner gets a soft push notification.
--   2. UI shows a countdown to cool_off_until. The partner can join
--      ('joined_at' timestamp) and add a reflection note before then;
--      neither party can mark complete until the timer elapses.
--   3. Either partner POSTs /api/repair/:id/complete → status='completed'
--      with optional joint commitment_note.
--   4. Either partner can POST /api/repair/:id/cancel any time → status='cancelled'.
--
-- We deliberately store reflection bodies (capped) so the couple can
-- look back at how they repaired — but ALSO honor a per-session
-- "ephemeral" flag: when set, a delete trigger drops the row 7 days
-- after completion. Audit-log tracks lifecycle but never the body.

CREATE TABLE IF NOT EXISTS repair_sessions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id         uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  initiator_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'cooldown',
  cool_off_until    timestamptz NOT NULL,
  initiator_note    text,
  partner_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  partner_joined_at timestamptz,
  partner_note      text,
  commitment_note   text,
  ephemeral         boolean NOT NULL DEFAULT false,
  started_at        timestamptz NOT NULL DEFAULT now(),
  completed_at      timestamptz,
  cancelled_at      timestamptz,
  CONSTRAINT repair_sessions_status_chk
    CHECK (status IN ('cooldown', 'reflecting', 'completed', 'cancelled')),
  CONSTRAINT repair_sessions_initiator_note_len
    CHECK (initiator_note IS NULL OR char_length(initiator_note) <= 1000),
  CONSTRAINT repair_sessions_partner_note_len
    CHECK (partner_note IS NULL OR char_length(partner_note) <= 1000),
  CONSTRAINT repair_sessions_commitment_note_len
    CHECK (commitment_note IS NULL OR char_length(commitment_note) <= 1000),
  CONSTRAINT repair_sessions_complete_consistent
    CHECK (
      (status = 'completed') = (completed_at IS NOT NULL)
    ),
  CONSTRAINT repair_sessions_cancel_consistent
    CHECK (
      (status = 'cancelled') = (cancelled_at IS NOT NULL)
    )
);

-- Only one active session per couple at a time. Avoids racing repair
-- flows and keeps the UI surface unambiguous.
CREATE UNIQUE INDEX IF NOT EXISTS repair_sessions_one_active_per_couple
  ON repair_sessions (couple_id)
  WHERE status IN ('cooldown', 'reflecting');

CREATE INDEX IF NOT EXISTS repair_sessions_couple_started_idx
  ON repair_sessions (couple_id, started_at DESC);

ALTER TABLE repair_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE repair_sessions FORCE ROW LEVEL SECURITY;

-- Both partners can read and write the row (it's about both of them).
DROP POLICY IF EXISTS repair_sessions_rw ON repair_sessions;
CREATE POLICY repair_sessions_rw
  ON repair_sessions
  FOR ALL
  TO authenticated
  USING (couple_id = app.current_couple_id())
  WITH CHECK (couple_id = app.current_couple_id());
