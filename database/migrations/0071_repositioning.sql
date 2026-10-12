-- Lagerungs- und Bewegungsprotokoll: Positionswechsel je Person. Das Intervall legt die Fachperson fest (wie in der
-- Pflegeplanung vereinbart); CareCore gibt keines vor. Einträge werden nicht gelöscht, sondern mit Grund storniert.
CREATE TABLE IF NOT EXISTS carecore_repositioning_plans (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  interval_minutes INTEGER NOT NULL CHECK (interval_minutes BETWEEN 15 AND 1440),
  -- Massnahme der Pflegeplanung, auf der das Intervall beruht (optional).
  intervention_id UUID REFERENCES carecore_interventions(id) ON DELETE SET NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  ended_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  end_reason TEXT NOT NULL DEFAULT '',
  CHECK (ended_at IS NULL OR btrim(end_reason) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS carecore_repositioning_plans_active_idx
  ON carecore_repositioning_plans (resident_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS carecore_repositioning_entries (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  performed_at TIMESTAMPTZ NOT NULL,
  position VARCHAR(24) NOT NULL CHECK (position IN ('back', 'right30', 'left30', 'right90', 'left90', 'semi_sitting',
    'sitting', 'mobilized', 'micro', 'other')),
  skin VARCHAR(24) NOT NULL CHECK (skin IN ('normal', 'blanching', 'non_blanching', 'broken', 'not_assessed')),
  note TEXT NOT NULL DEFAULT '',
  author_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  cancel_reason TEXT NOT NULL DEFAULT '',
  CHECK (position <> 'other' OR btrim(note) <> ''),
  CHECK (cancelled_at IS NULL OR btrim(cancel_reason) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_repositioning_entries_resident_idx
  ON carecore_repositioning_entries (resident_id, performed_at DESC);
