-- Impfungen je Person (dokumentiert, im Haus oder extern). CareCore gibt keine Impfempfehlungen und keine Fristen vor;
-- die Übersicht zeigt nur, wer seit einem selbst gewählten Datum gegen etwas geimpft ist.
CREATE TABLE IF NOT EXISTS carecore_vaccinations (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  given_on DATE NOT NULL,
  target VARCHAR(120) NOT NULL CHECK (btrim(target) <> ''),
  vaccine VARCHAR(200) NOT NULL DEFAULT '',
  lot VARCHAR(60) NOT NULL DEFAULT '',
  place VARCHAR(12) NOT NULL DEFAULT 'inhouse' CHECK (place IN ('inhouse', 'external')),
  given_by VARCHAR(200) NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS carecore_vaccinations_resident_idx ON carecore_vaccinations (resident_id, given_on DESC);
CREATE INDEX IF NOT EXISTS carecore_vaccinations_target_idx ON carecore_vaccinations (organization_id, lower(target));
