-- Messenger: Reaktionen auf Nachrichten (feste Auswahl) und @Erwähnungen von Mitgliedern der Unterhaltung.
CREATE TABLE IF NOT EXISTS carecore_message_reactions (
  message_id UUID NOT NULL REFERENCES carecore_messages(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  emoji VARCHAR(16) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS carecore_message_reactions_message_idx ON carecore_message_reactions (message_id);
ALTER TABLE carecore_messages ADD COLUMN IF NOT EXISTS mentions JSONB NOT NULL DEFAULT '[]'::jsonb;
