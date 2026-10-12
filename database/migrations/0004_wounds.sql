-- Wound management: classification, origin (quality indicator for pressure ulcers),
-- dressing interval for due dates, treatment plan and structured assessment fields.

ALTER TABLE carecore_wounds ADD COLUMN IF NOT EXISTS wound_type VARCHAR(80);
ALTER TABLE carecore_wounds ADD COLUMN IF NOT EXISTS category VARCHAR(80);
ALTER TABLE carecore_wounds ADD COLUMN IF NOT EXISTS origin VARCHAR(20) NOT NULL DEFAULT 'unknown' CHECK (origin IN ('inhouse', 'external', 'unknown'));
ALTER TABLE carecore_wounds ADD COLUMN IF NOT EXISTS care_interval_days SMALLINT CHECK (care_interval_days BETWEEN 1 AND 14);
ALTER TABLE carecore_wounds ADD COLUMN IF NOT EXISTS treatment_plan TEXT;
ALTER TABLE carecore_wounds ADD COLUMN IF NOT EXISTS closed_reason TEXT;

ALTER TABLE carecore_wound_entries ADD COLUMN IF NOT EXISTS entry_type VARCHAR(40) NOT NULL DEFAULT 'Verlaufskontrolle';
ALTER TABLE carecore_wound_entries ADD COLUMN IF NOT EXISTS wound_edge VARCHAR(120);
ALTER TABLE carecore_wound_entries ADD COLUMN IF NOT EXISTS surrounding_skin VARCHAR(120);
ALTER TABLE carecore_wound_entries ADD COLUMN IF NOT EXISTS odor BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE carecore_wound_entries ADD COLUMN IF NOT EXISTS infection_signs BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS carecore_wound_entries_observed_idx ON carecore_wound_entries (observed_at DESC);
