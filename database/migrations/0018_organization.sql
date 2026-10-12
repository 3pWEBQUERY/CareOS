-- Organisation: site and care unit details edited in "Leitung · Organisation".

ALTER TABLE carecore_sites ADD COLUMN IF NOT EXISTS code VARCHAR(12);
ALTER TABLE carecore_sites ADD COLUMN IF NOT EXISTS site_type VARCHAR(60);
ALTER TABLE carecore_sites ADD COLUMN IF NOT EXISTS country VARCHAR(60);
ALTER TABLE carecore_sites ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE carecore_sites ADD COLUMN IF NOT EXISTS manager_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_sites ADD COLUMN IF NOT EXISTS notes TEXT;
UPDATE carecore_sites SET status = CASE WHEN active THEN 'active' ELSE 'archived' END
  WHERE status NOT IN ('active', 'planned', 'archived');
ALTER TABLE carecore_sites DROP CONSTRAINT IF EXISTS carecore_sites_status_check;
ALTER TABLE carecore_sites ADD CONSTRAINT carecore_sites_status_check CHECK (status IN ('active', 'planned', 'archived'));

ALTER TABLE carecore_care_units ADD COLUMN IF NOT EXISTS lead_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_care_units ADD COLUMN IF NOT EXISTS services JSONB NOT NULL DEFAULT '["early","late"]'::jsonb;
ALTER TABLE carecore_care_units ADD COLUMN IF NOT EXISTS notes TEXT;

-- Organisation-wide settings of "Leitung · Konfiguration" live in carecore_organizations.settings.
