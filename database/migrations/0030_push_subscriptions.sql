-- Push-Benachrichtigungen (Web Push) für die installierte App. Ein Abonnement gehört zu einer Anmeldung:
-- Abmelden oder „Gerät abmelden“ beendet auch die Push-Nachrichten auf diesem Gerät.
CREATE TABLE IF NOT EXISTS carecore_push_subscriptions (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES carecore_sessions(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sent_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS carecore_push_subscriptions_user_idx ON carecore_push_subscriptions (user_id);

-- Versandmarke: jede Benachrichtigung wird höchstens einmal gepusht. Bestehende gelten als versandt.
ALTER TABLE carecore_notifications ADD COLUMN IF NOT EXISTS pushed_at TIMESTAMPTZ;
UPDATE carecore_notifications SET pushed_at = created_at WHERE pushed_at IS NULL;
CREATE INDEX IF NOT EXISTS carecore_notifications_push_pending_idx
  ON carecore_notifications (created_at) WHERE pushed_at IS NULL;
