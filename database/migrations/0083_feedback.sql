-- Rückmeldungen und Beschwerden von Angehörigen, Bewohnenden und weiteren Personen: Erfassung, Bearbeitung, Antwort
-- und Abschluss. Die Antwortfrist legt die Einrichtung fest (Einstellung feedbackResponseDays); ohne Vorgabe keine Frist.
CREATE TABLE IF NOT EXISTS carecore_feedback (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('complaint', 'suggestion', 'praise')),
  source VARCHAR(16) NOT NULL CHECK (source IN ('relative', 'resident', 'visitor', 'staff', 'other')),
  source_name VARCHAR(200) NOT NULL DEFAULT '',
  contact VARCHAR(200) NOT NULL DEFAULT '',
  channel VARCHAR(16) NOT NULL CHECK (channel IN ('in_person', 'phone', 'email', 'letter', 'other')),
  resident_id UUID REFERENCES carecore_residents(id) ON DELETE SET NULL,
  care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE SET NULL,
  topic VARCHAR(120) NOT NULL DEFAULT '',
  description TEXT NOT NULL CHECK (btrim(description) <> ''),
  received_on DATE NOT NULL,
  due_on DATE,
  assigned_to UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'answered', 'closed')),
  measures TEXT NOT NULL DEFAULT '',
  response TEXT NOT NULL DEFAULT '',
  answered_on DATE,
  answered_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  closed_at TIMESTAMPTZ,
  closed_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (answered_on IS NULL OR (btrim(response) <> '' AND answered_on >= received_on)),
  CHECK (status <> 'answered' OR answered_on IS NOT NULL),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS carecore_feedback_org_idx ON carecore_feedback (organization_id, received_on DESC);
CREATE INDEX IF NOT EXISTS carecore_feedback_resident_idx ON carecore_feedback (resident_id) WHERE resident_id IS NOT NULL;
