-- 0009 — N1 push subscription storage.
--
-- One row per browser/device push subscription. RLS is owner-only on
-- the read/delete path; the N3 delivery worker bypasses RLS via the
-- service-role key (so it can fan out a notification to both halves of
-- a couple). VAPID public key is published via /api/push/vapid-public-key
-- and stored as the PUBLIC_VAPID_KEY env var; the private key is a
-- Worker secret (PRIVATE_VAPID_KEY) consumed only by the delivery
-- worker. See scripts/generate-vapid-keys.ts.

CREATE TABLE IF NOT EXISTS push_subscription (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL,
  p256dh      text NOT NULL,
  auth        text NOT NULL,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS push_subscription_endpoint_idx
  ON push_subscription (endpoint);
CREATE INDEX IF NOT EXISTS push_subscription_user_idx
  ON push_subscription (user_id);

ALTER TABLE push_subscription ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS push_subscription_select_own ON push_subscription;
CREATE POLICY push_subscription_select_own ON push_subscription
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscription_insert_own ON push_subscription;
CREATE POLICY push_subscription_insert_own ON push_subscription
  FOR INSERT WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS push_subscription_delete_own ON push_subscription;
CREATE POLICY push_subscription_delete_own ON push_subscription
  FOR DELETE USING (auth.uid() = user_id);
