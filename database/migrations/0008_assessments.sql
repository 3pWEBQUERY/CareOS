-- Assessments: risk level and next reassessment date on completed records.

ALTER TABLE carecore_assessment_records ADD COLUMN IF NOT EXISTS risk_level VARCHAR(40);
ALTER TABLE carecore_assessment_records ADD COLUMN IF NOT EXISTS next_due_on DATE;

CREATE INDEX IF NOT EXISTS carecore_assessment_records_latest_idx
  ON carecore_assessment_records (resident_id, assessment_id, completed_at DESC) WHERE status = 'completed';
