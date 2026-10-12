-- Öffentliche Schnittstelle (FHIR R4, nur lesend): Schlüssel der Einrichtung. Gespeichert wird nur der SHA-256-Hash;
-- der Schlüssel selbst wird einmal beim Erstellen angezeigt. Jeder Zugriff wird im Änderungsprotokoll festgehalten.
CREATE TABLE IF NOT EXISTS carecore_api_keys (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  name VARCHAR(80) NOT NULL,
  key_prefix VARCHAR(16) NOT NULL,
  key_hash CHAR(64) NOT NULL UNIQUE,
  scopes TEXT[] NOT NULL,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  CHECK (cardinality(scopes) > 0)
);

CREATE INDEX IF NOT EXISTS carecore_api_keys_org_idx ON carecore_api_keys (organization_id, created_at DESC);
