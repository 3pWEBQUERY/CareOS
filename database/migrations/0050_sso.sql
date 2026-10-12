-- SSO über OpenID Connect (Authorization Code mit PKCE), je Einrichtung. Angemeldet werden nur bestehende Konten:
-- ein Claim des Identity-Providers (z. B. preferred_username oder email) muss dem Benutzernamen in CareCore
-- entsprechen. Das Client-Secret liegt verschlüsselt (AES-256-GCM, Schlüssel aus CARECORE_MFA_KEY).
CREATE TABLE IF NOT EXISTS carecore_sso_settings (
  organization_id UUID PRIMARY KEY REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  issuer VARCHAR(300) NOT NULL,
  client_id VARCHAR(200) NOT NULL,
  client_secret_encrypted TEXT,
  username_claim VARCHAR(40) NOT NULL DEFAULT 'preferred_username'
    CHECK (username_claim IN ('preferred_username', 'email', 'upn', 'sub')),
  button_label VARCHAR(60) NOT NULL DEFAULT 'SSO',
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Laufende Anmeldungen (10 Minuten): nur als Hash des state adressiert, einmal einlösbar.
CREATE TABLE IF NOT EXISTS carecore_sso_requests (
  state_hash CHAR(64) PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  code_verifier VARCHAR(200) NOT NULL,
  nonce VARCHAR(200) NOT NULL,
  next_path VARCHAR(300),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
