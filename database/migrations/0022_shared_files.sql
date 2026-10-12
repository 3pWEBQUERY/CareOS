-- Gemeinsame Ablage: files shared with the whole house, optionally sorted into folders.

CREATE TABLE IF NOT EXISTS carecore_shared_folders (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  name VARCHAR(120) NOT NULL,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, name)
);

ALTER TABLE carecore_cloud_files
  ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES carecore_shared_folders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS carecore_cloud_files_shared_idx
  ON carecore_cloud_files (organization_id, purpose, folder_id, created_at DESC);

ALTER TABLE carecore_cloud_files DROP CONSTRAINT IF EXISTS carecore_cloud_files_purpose_check;
ALTER TABLE carecore_cloud_files ADD CONSTRAINT carecore_cloud_files_purpose_check
  CHECK (purpose IN ('cloud', 'shared', 'certificate', 'document'));

-- Personal files without a known uploader were visible to everyone before files became
-- personal; they move to the shared storage so nobody loses access to them.
UPDATE carecore_cloud_files SET purpose = 'shared' WHERE purpose = 'cloud' AND uploaded_by IS NULL;
