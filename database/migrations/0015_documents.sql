-- Documents and standards: files, versions, approval, review dates, archive and read confirmations.

ALTER TABLE carecore_documents ALTER COLUMN storage_key DROP NOT NULL;
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'document'
  CHECK (kind IN ('document', 'standard'));
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS file_id UUID REFERENCES carecore_cloud_files(id) ON DELETE SET NULL;
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS version_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS previous_id UUID REFERENCES carecore_documents(id) ON DELETE SET NULL;
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS change_note TEXT;
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS requires_ack BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS review_due_on DATE;
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS archived_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_documents ADD COLUMN IF NOT EXISTS archive_reason TEXT;

UPDATE carecore_documents SET status = 'active' WHERE status NOT IN ('draft', 'active', 'superseded', 'archived');
ALTER TABLE carecore_documents DROP CONSTRAINT IF EXISTS carecore_documents_status_check;
ALTER TABLE carecore_documents ADD CONSTRAINT carecore_documents_status_check
  CHECK (status IN ('draft', 'active', 'superseded', 'archived'));

-- Earlier standards and directives were stored as plain documents.
UPDATE carecore_documents SET kind = 'standard', category = 'Pflegestandard', approved_at = COALESCE(approved_at, created_at)
WHERE category = 'Standard';
UPDATE carecore_documents SET kind = 'standard', approved_at = COALESCE(approved_at, created_at) WHERE category = 'Weisung';

CREATE INDEX IF NOT EXISTS carecore_documents_org_kind_idx ON carecore_documents (organization_id, kind, status);

CREATE TABLE IF NOT EXISTS carecore_document_reads (
  document_id UUID NOT NULL REFERENCES carecore_documents(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  acknowledged_at TIMESTAMPTZ,
  PRIMARY KEY (document_id, user_id)
);
