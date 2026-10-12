-- Alltagsgestaltung und Aktivierung: geplante Angebote (Gruppe oder Einzelbetreuung) und die Teilnahme je Person.
CREATE TABLE IF NOT EXISTS carecore_activities (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  -- NULL: Angebot für das ganze Haus.
  care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE SET NULL,
  -- Wöchentlich geplante Angebote teilen sich die Serie.
  series_id UUID,
  title VARCHAR(160) NOT NULL CHECK (btrim(title) <> ''),
  category VARCHAR(60) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location VARCHAR(160) NOT NULL DEFAULT '',
  leader VARCHAR(160) NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  duration_minutes INT NOT NULL CHECK (duration_minutes BETWEEN 5 AND 600),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  cancel_reason TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (cancelled_at IS NULL OR btrim(cancel_reason) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_activities_org_idx ON carecore_activities (organization_id, starts_at);

CREATE TABLE IF NOT EXISTS carecore_activity_participations (
  activity_id UUID NOT NULL REFERENCES carecore_activities(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  status VARCHAR(16) NOT NULL CHECK (status IN ('participated', 'declined', 'absent')),
  note VARCHAR(1000) NOT NULL DEFAULT '',
  recorded_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (activity_id, resident_id)
);
CREATE INDEX IF NOT EXISTS carecore_activity_participations_resident_idx
  ON carecore_activity_participations (resident_id, recorded_at DESC);
