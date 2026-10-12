-- Portal für Angehörige und Ärztinnen/Ärzte: eigene Zugänge (keine Mitarbeitenden-Konten), eigene Sitzungen und
-- Freigaben je Person oder Wohnbereich mit den freigegebenen Bereichen, Gültigkeit und festgehaltener Grundlage.
-- Jeder Zugriff wird protokolliert.
CREATE TABLE IF NOT EXISTS carecore_portal_accounts (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  kind VARCHAR(20) NOT NULL CHECK (kind IN ('relative', 'physician')),
  display_name VARCHAR(160) NOT NULL,
  username VARCHAR(80) NOT NULL,
  email VARCHAR(200) NOT NULL DEFAULT '',
  phone VARCHAR(60) NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  must_change_password BOOLEAN NOT NULL DEFAULT TRUE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_login_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS carecore_portal_accounts_username_idx ON carecore_portal_accounts (LOWER(username));
CREATE INDEX IF NOT EXISTS carecore_portal_accounts_org_idx ON carecore_portal_accounts (organization_id);

CREATE TABLE IF NOT EXISTS carecore_portal_sessions (
  token_hash VARCHAR(64) PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES carecore_portal_accounts(id) ON DELETE CASCADE,
  user_agent VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS carecore_portal_sessions_account_idx ON carecore_portal_sessions (account_id);

CREATE TABLE IF NOT EXISTS carecore_portal_grants (
  id UUID PRIMARY KEY,
  account_id UUID NOT NULL REFERENCES carecore_portal_accounts(id) ON DELETE CASCADE,
  resident_id UUID REFERENCES carecore_residents(id) ON DELETE CASCADE,
  care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE CASCADE,
  areas JSONB NOT NULL DEFAULT '[]'::jsonb,
  valid_from DATE,
  valid_until DATE,
  basis VARCHAR(30) NOT NULL CHECK (basis IN ('consent', 'representative', 'treatment')),
  basis_note VARCHAR(500) NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  CHECK ((resident_id IS NULL) <> (care_unit_id IS NULL)),
  CHECK (valid_until IS NULL OR valid_from IS NULL OR valid_until >= valid_from)
);
CREATE INDEX IF NOT EXISTS carecore_portal_grants_account_idx ON carecore_portal_grants (account_id);

CREATE TABLE IF NOT EXISTS carecore_portal_access_log (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES carecore_portal_accounts(id) ON DELETE CASCADE,
  resident_id UUID REFERENCES carecore_residents(id) ON DELETE SET NULL,
  action VARCHAR(40) NOT NULL,
  areas JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_agent VARCHAR(300),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS carecore_portal_access_log_account_idx ON carecore_portal_access_log (account_id, created_at DESC);
