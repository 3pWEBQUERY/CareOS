-- Wechselwirkungen: Hinweise, die die Einrichtung selbst erfasst (z. B. von der betreuenden Apotheke), mit Quelle.
-- CareCore enthält keine eigenen Regeln; eine lizenzierte Arzneimitteldatenbank kann später als weitere Quelle
-- dazukommen (lib/medication-interactions.ts).
CREATE TABLE IF NOT EXISTS carecore_medication_interactions (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  substance_a VARCHAR(120) NOT NULL,
  substance_b VARCHAR(120) NOT NULL,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('contraindicated', 'major', 'moderate', 'minor')),
  description TEXT NOT NULL,
  recommendation TEXT NOT NULL DEFAULT '',
  source VARCHAR(240) NOT NULL,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (LOWER(substance_a) <> LOWER(substance_b))
);

CREATE INDEX IF NOT EXISTS carecore_medication_interactions_org_idx ON carecore_medication_interactions (organization_id);
