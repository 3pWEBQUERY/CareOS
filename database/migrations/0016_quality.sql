-- Quality management: events get a title, owner and resolution trail; improvement
-- actions (Massnahmen) are planned, assigned and evaluated for effectiveness.

ALTER TABLE carecore_quality_events ADD COLUMN IF NOT EXISTS title VARCHAR(180);
ALTER TABLE carecore_quality_events ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_quality_events ADD COLUMN IF NOT EXISTS immediate_action TEXT;
ALTER TABLE carecore_quality_events ADD COLUMN IF NOT EXISTS resolved_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
UPDATE carecore_quality_events SET severity = 'attention' WHERE severity NOT IN ('info', 'attention', 'critical');
ALTER TABLE carecore_quality_events DROP CONSTRAINT IF EXISTS carecore_quality_events_severity_check;
ALTER TABLE carecore_quality_events ADD CONSTRAINT carecore_quality_events_severity_check
  CHECK (severity IN ('info', 'attention', 'critical'));
CREATE INDEX IF NOT EXISTS carecore_quality_events_org_time_idx ON carecore_quality_events (organization_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS carecore_quality_actions (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  quality_event_id UUID REFERENCES carecore_quality_events(id) ON DELETE SET NULL,
  care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE SET NULL,
  title VARCHAR(180) NOT NULL,
  description TEXT,
  owner_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  due_on DATE,
  status VARCHAR(24) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'planned', 'done', 'cancelled')),
  effectiveness VARCHAR(24) CHECK (effectiveness IN ('effective', 'partially', 'not_effective')),
  completion_note TEXT,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'done' OR completed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS carecore_quality_actions_org_status_idx ON carecore_quality_actions (organization_id, status, due_on);
CREATE INDEX IF NOT EXISTS carecore_quality_actions_event_idx ON carecore_quality_actions (quality_event_id);
