-- Zwei-Faktor-Anmeldung (TOTP, RFC 6238). Das Geheimnis liegt verschlüsselt (AES-256-GCM, Schlüssel aus
-- CARECORE_MFA_KEY) in der Datenbank; Wiederherstellungscodes nur als Hash. Eine Anmeldung mit Passwort erzeugt
-- bei aktiver Zwei-Faktor-Anmeldung zuerst eine kurzlebige Anfrage, erst der Code erzeugt die Sitzung.

CREATE TABLE IF NOT EXISTS carecore_user_mfa (
  user_id UUID PRIMARY KEY REFERENCES carecore_users(id) ON DELETE CASCADE,
  secret_encrypted TEXT NOT NULL,
  confirmed_at TIMESTAMPTZ,
  last_used_step BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carecore_mfa_recovery_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  code_hash CHAR(64) NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, code_hash)
);

CREATE TABLE IF NOT EXISTS carecore_mfa_challenges (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  user_agent VARCHAR(300),
  attempts SMALLINT NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS carecore_mfa_challenges_expiry_idx ON carecore_mfa_challenges (expires_at);
