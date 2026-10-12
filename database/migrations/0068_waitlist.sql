-- Belegung und Eintritt: Warteliste der Interessentinnen und Interessenten. Wird ein Platz vergeben, entsteht ein geplanter
-- Eintritt (Person mit Status 'planned'); der Eintrag verweist dann auf diese Person.
CREATE TABLE IF NOT EXISTS carecore_waitlist_entries (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  first_name VARCHAR(100) NOT NULL CHECK (btrim(first_name) <> ''),
  last_name VARCHAR(100) NOT NULL CHECK (btrim(last_name) <> ''),
  date_of_birth DATE,
  contact_name VARCHAR(160) NOT NULL DEFAULT '',
  contact_phone VARCHAR(60) NOT NULL DEFAULT '',
  contact_email VARCHAR(200) NOT NULL DEFAULT '',
  desired_care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE SET NULL,
  desired_from DATE,
  registered_on DATE NOT NULL,
  -- Angaben zum Bedarf, wie sie mitgeteilt wurden (keine Einstufung durch CareCore).
  note TEXT NOT NULL DEFAULT '',
  status VARCHAR(16) NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'offered', 'admitted', 'withdrawn')),
  status_note TEXT NOT NULL DEFAULT '',
  resident_id UUID REFERENCES carecore_residents(id) ON DELETE SET NULL,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'withdrawn' OR btrim(status_note) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_waitlist_org_idx ON carecore_waitlist_entries (organization_id, status, registered_on);
