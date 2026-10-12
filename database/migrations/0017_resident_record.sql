-- Resident record: master data that was only shown as sample values in the record,
-- and the time the master data was last checked.

ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS marital_status VARCHAR(40);
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS religion VARCHAR(80);
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS social_security_number VARCHAR(20);
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS admission_reason VARCHAR(160);
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS gp_name VARCHAR(160);
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS gp_practice VARCHAR(200);
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS gp_phone VARCHAR(60);
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS pharmacy VARCHAR(200);
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS insurer VARCHAR(160);
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS insurance_number VARCHAR(40);
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS master_data_checked_at TIMESTAMPTZ;
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS master_data_checked_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS carecore_documents_resident_idx ON carecore_documents (resident_id, created_at DESC) WHERE resident_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS carecore_vital_measurements_resident_time_idx ON carecore_vital_measurements (resident_id, measured_at DESC);
