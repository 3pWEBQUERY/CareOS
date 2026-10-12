-- Freiheitsbeschränkende Massnahmen (FBM): Protokoll je Person mit Art, Grund, geprüften milderen Massnahmen,
-- anordnender Person, Information der Person und ihrer Vertretung, Beginn, Dauer und Ende sowie Überprüfungen.
-- Grundlagen: CH ZGB Art. 383–385, DE § 1831 Abs. 4 BGB, AT Heimaufenthaltsgesetz. Fristen legt die Einrichtung
-- fest (Datum der nächsten Überprüfung je Massnahme); CareCore enthält keine eigenen Vorgaben.
CREATE TABLE IF NOT EXISTS carecore_restraint_measures (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  kind VARCHAR(30) NOT NULL
    CHECK (kind IN ('bed_rails', 'belt', 'sensor_mat', 'locked_door', 'therapy_table', 'medication', 'other')),
  description TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL CHECK (LENGTH(TRIM(reason)) > 0),
  alternatives TEXT NOT NULL CHECK (LENGTH(TRIM(alternatives)) > 0),
  schedule TEXT NOT NULL DEFAULT '',
  ordered_by VARCHAR(160) NOT NULL CHECK (LENGTH(TRIM(ordered_by)) > 0),
  resident_consent VARCHAR(20) NOT NULL CHECK (resident_consent IN ('consents', 'refuses', 'incapable')),
  resident_informed BOOLEAN NOT NULL DEFAULT FALSE,
  representative_name VARCHAR(160) NOT NULL DEFAULT '',
  representative_informed_on DATE,
  approval_reference VARCHAR(240) NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ NOT NULL,
  planned_until DATE,
  review_on DATE NOT NULL,
  ended_at TIMESTAMPTZ,
  end_reason TEXT NOT NULL DEFAULT '',
  ended_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (kind <> 'other' OR LENGTH(TRIM(description)) > 0),
  CHECK (ended_at IS NULL OR ended_at >= starts_at),
  CHECK (ended_at IS NULL OR LENGTH(TRIM(end_reason)) > 0)
);

CREATE INDEX IF NOT EXISTS carecore_restraint_measures_resident_idx ON carecore_restraint_measures (resident_id, starts_at DESC);
CREATE INDEX IF NOT EXISTS carecore_restraint_measures_active_idx ON carecore_restraint_measures (organization_id, review_on)
  WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS carecore_restraint_reviews (
  id UUID PRIMARY KEY,
  measure_id UUID NOT NULL REFERENCES carecore_restraint_measures(id) ON DELETE CASCADE,
  reviewed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  outcome VARCHAR(20) NOT NULL CHECK (outcome IN ('continue', 'end')),
  note TEXT NOT NULL CHECK (LENGTH(TRIM(note)) > 0),
  next_review_on DATE,
  CHECK (outcome = 'end' OR next_review_on IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS carecore_restraint_reviews_measure_idx ON carecore_restraint_reviews (measure_id, reviewed_at DESC);
