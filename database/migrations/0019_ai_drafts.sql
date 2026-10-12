-- CareCore KI: context and outcome of reviewed drafts.

ALTER TABLE carecore_ai_drafts ADD COLUMN IF NOT EXISTS care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE SET NULL;
ALTER TABLE carecore_ai_drafts ADD COLUMN IF NOT EXISTS saved_entity_type VARCHAR(40);
ALTER TABLE carecore_ai_drafts ADD COLUMN IF NOT EXISTS saved_entity_id UUID;
ALTER TABLE carecore_ai_drafts ADD COLUMN IF NOT EXISTS model VARCHAR(80);

CREATE INDEX IF NOT EXISTS carecore_ai_drafts_org_status_idx ON carecore_ai_drafts (organization_id, status, created_at DESC);
