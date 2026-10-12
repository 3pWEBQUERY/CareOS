-- Isolation und Ausbruch: organisatorische Übersicht der Hygienemassnahmen je Person und Wohnbereich. CareCore stellt
-- keine Diagnose und erklärt keinen Ausbruch selbst: Anlass und Anordnung werden erfasst, den Ausbruch erklärt die Leitung.
CREATE TABLE IF NOT EXISTS carecore_outbreaks (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  -- NULL: ganzes Haus.
  care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE SET NULL,
  title VARCHAR(160) NOT NULL CHECK (btrim(title) <> ''),
  measures TEXT NOT NULL DEFAULT '',
  declared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  declared_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  authority_reported_on DATE,
  authority_note VARCHAR(400) NOT NULL DEFAULT '',
  ended_at TIMESTAMPTZ,
  ended_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  end_note TEXT NOT NULL DEFAULT '',
  CHECK (ended_at IS NULL OR btrim(end_note) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_outbreaks_org_idx ON carecore_outbreaks (organization_id, ended_at, declared_at DESC);

CREATE TABLE IF NOT EXISTS carecore_isolation_measures (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE SET NULL,
  outbreak_id UUID REFERENCES carecore_outbreaks(id) ON DELETE SET NULL,
  kind VARCHAR(24) NOT NULL CHECK (kind IN ('contact', 'droplet', 'airborne', 'protective', 'other')),
  -- Anlass laut Anordnung (Ärztin/Arzt, Hygienefachperson, Labor); keine Einschätzung durch CareCore.
  reason TEXT NOT NULL CHECK (btrim(reason) <> ''),
  precautions TEXT NOT NULL DEFAULT '',
  ordered_by VARCHAR(160) NOT NULL CHECK (btrim(ordered_by) <> ''),
  starts_at TIMESTAMPTZ NOT NULL,
  review_on DATE NOT NULL,
  ended_at TIMESTAMPTZ,
  ended_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  end_note TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ended_at IS NULL OR btrim(end_note) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_isolation_org_idx ON carecore_isolation_measures (organization_id, ended_at);
CREATE INDEX IF NOT EXISTS carecore_isolation_resident_idx ON carecore_isolation_measures (resident_id, starts_at DESC);

CREATE TABLE IF NOT EXISTS carecore_isolation_reviews (
  id UUID PRIMARY KEY,
  measure_id UUID NOT NULL REFERENCES carecore_isolation_measures(id) ON DELETE CASCADE,
  reviewed_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('continue', 'end')),
  note TEXT NOT NULL CHECK (btrim(note) <> ''),
  next_review_on DATE
);
CREATE INDEX IF NOT EXISTS carecore_isolation_reviews_measure_idx ON carecore_isolation_reviews (measure_id, reviewed_at);
