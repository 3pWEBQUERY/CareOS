-- E-Mail-Adresse der Mitarbeitenden (für „Passwort vergessen“ und Einladungen) und einmalige Links zum Setzen
-- eines Passworts. Gespeichert wird nur der SHA-256-Wert des Links, nie der Link selbst.

ALTER TABLE carecore_user_profiles ADD COLUMN IF NOT EXISTS email VARCHAR(200);

CREATE UNIQUE INDEX IF NOT EXISTS carecore_user_profiles_email_key
  ON carecore_user_profiles (lower(email)) WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS carecore_password_links (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  purpose VARCHAR(10) NOT NULL CHECK (purpose IN ('reset', 'invite')),
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS carecore_password_links_user_idx ON carecore_password_links (user_id, created_at DESC);
