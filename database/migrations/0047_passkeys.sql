-- Passkeys (WebAuthn): Anmeldung ohne Passwort mit einem Schlüssel auf dem Gerät (Fingerabdruck, Gesicht, PIN).
-- Gespeichert wird nur der öffentliche Schlüssel; die Anmeldung verlangt die Bestätigung am Gerät und gilt daher
-- als starke Anmeldung (ersetzt Passwort und Code).
CREATE TABLE IF NOT EXISTS carecore_passkeys (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  credential_id TEXT NOT NULL UNIQUE,
  public_key TEXT NOT NULL,
  counter BIGINT NOT NULL DEFAULT 0,
  transports TEXT[] NOT NULL DEFAULT '{}',
  name VARCHAR(80) NOT NULL,
  backed_up BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS carecore_passkeys_user_idx ON carecore_passkeys (user_id);

-- Kurzlebige Herausforderungen (5 Minuten) für Registrierung und Anmeldung; nur als Hash des Tokens adressiert.
CREATE TABLE IF NOT EXISTS carecore_webauthn_challenges (
  token_hash CHAR(64) PRIMARY KEY,
  user_id UUID REFERENCES carecore_users(id) ON DELETE CASCADE,
  purpose VARCHAR(16) NOT NULL CHECK (purpose IN ('register', 'login')),
  challenge TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
