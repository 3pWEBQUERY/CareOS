-- Hilfsmittel und persönliche Gegenstände je Person (z. B. Brille, Hörgerät, Zahnprothese, Rollator) mit Kennzeichnung
-- und Standort, damit nichts verloren geht. Nicht mehr vorhandene Gegenstände bleiben mit Grund im Verlauf.
CREATE TABLE IF NOT EXISTS carecore_resident_belongings (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  kind VARCHAR(12) NOT NULL DEFAULT 'aid' CHECK (kind IN ('aid', 'personal')),
  name VARCHAR(160) NOT NULL CHECK (btrim(name) <> ''),
  marking VARCHAR(160) NOT NULL DEFAULT '',
  location VARCHAR(200) NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_at TIMESTAMPTZ,
  removed_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  removed_reason VARCHAR(500) NOT NULL DEFAULT '',
  CHECK (removed_at IS NULL OR btrim(removed_reason) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_resident_belongings_resident_idx ON carecore_resident_belongings (resident_id);
