-- 0020 — F7 couple-only chat (text, 7-day TTL).
--
-- Ephemeral chat messages between the two members of a couple. Hard
-- TTL of 7 days enforced by:
--   1. pg_cron physical purge (drizzle/manual/0021_chat_messages_purge_cron.sql)
--   2. Read-time filter in the service AND the RLS SELECT policy
--      (defence-in-depth — eventual cron deletion alone would let rows
--      live up to 7d + cron_period before disappearing).
--
-- Realtime: server emits `chat_message` over the existing private
-- couple channel. Push notifications do NOT include the body — only a
-- "<sender_name>" preface, mirroring F16's lockscreen-privacy stance.
--
-- No `kind` enum (text-only by design); voice notes are deferred to F7
-- v2 once the Storage bucket exists (G3). YAGNI keeps this table clean.

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  couple_id uuid NOT NULL REFERENCES couple(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Composite index for cursor pagination by (created_at DESC, id DESC).
-- Keeps the read query (most-recent-N for a couple) cheap and stable
-- under bursts where multiple rows share a created_at ms.
CREATE INDEX IF NOT EXISTS chat_messages_couple_created_idx
  ON chat_messages (couple_id, created_at DESC, id DESC);

ALTER TABLE chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages FORCE ROW LEVEL SECURITY;

-- SELECT: any couple member can read messages for their couple, but
-- the policy includes the 7-day retention filter so rows that haven't
-- been physically purged yet are still invisible to clients.
DROP POLICY IF EXISTS chat_messages_select_member ON chat_messages;
CREATE POLICY chat_messages_select_member ON chat_messages
  FOR SELECT
  USING (
    created_at >= now() - interval '7 days'
    AND EXISTS (
      SELECT 1 FROM couple c
      WHERE c.id = chat_messages.couple_id
        AND (c.partner_a = auth.uid() OR c.partner_b = auth.uid())
    )
  );

-- INSERT: only the sender themselves, and only into a couple they're
-- a member of. The service-role backend bypasses RLS, but a direct
-- supabase-js INSERT from a malicious client must be denied.
DROP POLICY IF EXISTS chat_messages_insert_self ON chat_messages;
CREATE POLICY chat_messages_insert_self ON chat_messages
  FOR INSERT
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM couple c
      WHERE c.id = chat_messages.couple_id
        AND (c.partner_a = auth.uid() OR c.partner_b = auth.uid())
    )
  );

-- No UPDATE / DELETE policies: chat is append-only from the client's
-- perspective. The pg_cron purge runs as the table owner so it
-- bypasses RLS.
