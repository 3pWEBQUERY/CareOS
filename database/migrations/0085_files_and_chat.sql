-- Ablage wie ein Dateibereich im Team: Ordner in Ordnern, persönliche Ordner („Meine Dateien“), Papierkorb und
-- Versionen; Textdateien lassen sich direkt bearbeiten (jede Speicherung legt die vorherige Fassung als Version ab).
ALTER TABLE carecore_shared_folders
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES carecore_shared_folders(id) ON DELETE CASCADE;
-- Gesetzt: persönlicher Ordner dieser Person; leer: Ordner der gemeinsamen Ablage.
ALTER TABLE carecore_shared_folders
  ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES carecore_users(id) ON DELETE CASCADE;
ALTER TABLE carecore_shared_folders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE carecore_shared_folders
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_shared_folders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Gleiche Namen sind in verschiedenen Ordnern erlaubt, im selben Ordner nicht (Gross-/Kleinschreibung egal).
ALTER TABLE carecore_shared_folders DROP CONSTRAINT IF EXISTS carecore_shared_folders_organization_id_name_key;
CREATE UNIQUE INDEX IF NOT EXISTS carecore_shared_folders_name_idx ON carecore_shared_folders (
  organization_id,
  COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
  COALESCE(parent_id, '00000000-0000-0000-0000-000000000000'::uuid),
  lower(name)
) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS carecore_shared_folders_parent_idx ON carecore_shared_folders (organization_id, parent_id);

ALTER TABLE carecore_cloud_files ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE carecore_cloud_files
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_cloud_files
  ADD COLUMN IF NOT EXISTS updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_cloud_files ADD COLUMN IF NOT EXISTS version_no INTEGER NOT NULL DEFAULT 1;
-- Dateien, die im Messenger geteilt werden: gehören zur Unterhaltung, lesbar für deren Mitglieder.
ALTER TABLE carecore_cloud_files
  ADD COLUMN IF NOT EXISTS conversation_id UUID REFERENCES carecore_conversations(id) ON DELETE CASCADE;
ALTER TABLE carecore_cloud_files DROP CONSTRAINT IF EXISTS carecore_cloud_files_purpose_check;
ALTER TABLE carecore_cloud_files ADD CONSTRAINT carecore_cloud_files_purpose_check
  CHECK (purpose IN ('cloud', 'shared', 'certificate', 'document', 'chat'));
CREATE INDEX IF NOT EXISTS carecore_cloud_files_conversation_idx
  ON carecore_cloud_files (conversation_id, created_at DESC) WHERE conversation_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS carecore_cloud_file_versions (
  id UUID PRIMARY KEY,
  file_id UUID NOT NULL REFERENCES carecore_cloud_files(id) ON DELETE CASCADE,
  version_no INTEGER NOT NULL,
  name VARCHAR(220) NOT NULL,
  mime_type VARCHAR(160) NOT NULL,
  size_bytes BIGINT NOT NULL CHECK (size_bytes >= 0),
  content_base64 TEXT,
  storage_key TEXT,
  uploaded_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL,
  archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (content_base64 IS NOT NULL OR storage_key IS NOT NULL),
  UNIQUE (file_id, version_no)
);

-- Messenger: Antworten mit Zitat, gelöschte und angeheftete Nachrichten, Wichtigkeit, Systemhinweise
-- (z. B. „… hat … hinzugefügt“); je Person angeheftete und stummgeschaltete Unterhaltungen.
ALTER TABLE carecore_messages
  ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES carecore_messages(id) ON DELETE SET NULL;
ALTER TABLE carecore_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE carecore_messages ADD COLUMN IF NOT EXISTS pinned_at TIMESTAMPTZ;
ALTER TABLE carecore_messages
  ADD COLUMN IF NOT EXISTS pinned_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_messages ADD COLUMN IF NOT EXISTS priority VARCHAR(16) NOT NULL DEFAULT 'normal'
  CHECK (priority IN ('normal', 'important', 'urgent'));
ALTER TABLE carecore_messages ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'text'
  CHECK (kind IN ('text', 'system'));
ALTER TABLE carecore_conversation_members ADD COLUMN IF NOT EXISTS pinned BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE carecore_conversation_members ADD COLUMN IF NOT EXISTS muted BOOLEAN NOT NULL DEFAULT FALSE;
