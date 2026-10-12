-- Diagnosen je Person, wie von Ärztin/Arzt gestellt (z. B. aus dem Arztbericht übernommen). CareCore stellt keine
-- Diagnosen; der ICD-10-Code ist freiwillig und wird nur auf seine Form geprüft (keine Code-Datenbank).
CREATE TABLE IF NOT EXISTS carecore_resident_diagnoses (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  label VARCHAR(200) NOT NULL CHECK (btrim(label) <> ''),
  icd_code VARCHAR(12) NOT NULL DEFAULT '',
  kind VARCHAR(12) NOT NULL DEFAULT 'secondary' CHECK (kind IN ('main', 'secondary')),
  since_on DATE,
  source VARCHAR(200) NOT NULL DEFAULT '',
  status VARCHAR(12) NOT NULL DEFAULT 'current' CHECK (status IN ('current', 'resolved')),
  resolved_on DATE,
  note TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status = 'resolved' OR resolved_on IS NULL)
);
CREATE INDEX IF NOT EXISTS carecore_resident_diagnoses_resident_idx ON carecore_resident_diagnoses (resident_id);
