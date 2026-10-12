-- Handover notes: organization scope, known priorities and read confirmations per person.

ALTER TABLE carecore_handovers ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES carecore_organizations(id) ON DELETE CASCADE;

UPDATE carecore_handovers h SET organization_id = r.organization_id
FROM carecore_residents r WHERE h.organization_id IS NULL AND r.id = h.resident_id;

UPDATE carecore_handovers h SET organization_id = si.organization_id
FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
WHERE h.organization_id IS NULL AND cu.id = h.care_unit_id;

DELETE FROM carecore_handovers WHERE organization_id IS NULL;
ALTER TABLE carecore_handovers ALTER COLUMN organization_id SET NOT NULL;

UPDATE carecore_handovers SET priority = 'normal' WHERE priority NOT IN ('normal', 'high', 'critical');
ALTER TABLE carecore_handovers ADD CONSTRAINT carecore_handovers_priority_check CHECK (priority IN ('normal', 'high', 'critical'));

CREATE TABLE IF NOT EXISTS carecore_handover_reads (
  handover_id UUID NOT NULL REFERENCES carecore_handovers(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (handover_id, user_id)
);

CREATE INDEX IF NOT EXISTS carecore_handovers_org_time_idx ON carecore_handovers (organization_id, created_at DESC);
