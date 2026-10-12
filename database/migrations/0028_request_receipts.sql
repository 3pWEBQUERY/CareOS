-- Offline erfasste Einträge werden später gesendet, unter Umständen mehrfach (Verbindung bricht nach dem
-- Speichern ab). Jede Anfrage trägt eine Kennung; die Quittung entsteht in derselben Transaktion wie der
-- Eintrag, so wird derselbe Eintrag nie doppelt gespeichert.
CREATE TABLE IF NOT EXISTS carecore_request_receipts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS carecore_request_receipts_created_idx ON carecore_request_receipts (created_at);
