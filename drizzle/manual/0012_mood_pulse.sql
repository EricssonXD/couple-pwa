-- 0012 — F5 mood pulse.
--
-- Per-user mood expressed as a 5-emoji bucket: joyful / happy / neutral /
-- sad / upset. Append-only history so /settings can render the user's
-- own trend strip; latest-per-user-per-couple is queried server-side
-- with Drizzle (privileged) for /pulse partner-mood display.
--
-- Privacy decision (deliberate, mirrors H5 audit_log):
--   The partner cannot SELECT the other partner's full mood history via
--   supabase-js — only their own. This prevents a partner from running a
--   mood timeline analysis on the other person's emotional state, which
--   would be a coercion vector. Latest-only mood for /pulse is shipped
--   to the client through SSR page data (Drizzle bypasses RLS), so the
--   product UX is unaffected while client-side history reads stay scoped.
--
-- Inserts only via the server (service role). No client write policy.

CREATE TABLE IF NOT EXISTS mood_pulse (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  couple_id   uuid NOT NULL REFERENCES public.couple(id) ON DELETE CASCADE,
  mood        text NOT NULL CHECK (mood IN ('joyful','happy','neutral','sad','upset')),
  set_at      timestamptz NOT NULL DEFAULT now()
);

-- Latest-per-(couple,user) lookup for /pulse.
CREATE INDEX IF NOT EXISTS mood_pulse_couple_user_idx
  ON mood_pulse (couple_id, user_id, set_at DESC);

-- User's own trend (last N days) for /settings.
CREATE INDEX IF NOT EXISTS mood_pulse_user_idx
  ON mood_pulse (user_id, set_at DESC);

ALTER TABLE mood_pulse ENABLE ROW LEVEL SECURITY;
ALTER TABLE mood_pulse FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mood_pulse_select_own ON mood_pulse;
CREATE POLICY mood_pulse_select_own
  ON mood_pulse
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Inserts go through the server (service role bypasses RLS).
-- No INSERT/UPDATE/DELETE policy = denied for end users.
