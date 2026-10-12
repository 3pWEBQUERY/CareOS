-- Wound photos (binary, access-controlled via the API) and the link between a
-- wound and its marker on the resident's body map.

CREATE TABLE IF NOT EXISTS carecore_wound_photos (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  wound_id UUID NOT NULL REFERENCES carecore_wounds(id) ON DELETE CASCADE,
  mime_type VARCHAR(40) NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes INTEGER NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 3145728),
  width INTEGER,
  height INTEGER,
  content BYTEA NOT NULL,
  caption VARCHAR(240),
  taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consent_confirmed BOOLEAN NOT NULL CHECK (consent_confirmed),
  uploaded_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  -- Photos are part of the care record: they are hidden, never hard-deleted.
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  delete_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS carecore_wound_photos_wound_idx ON carecore_wound_photos (wound_id, taken_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE carecore_body_observations ADD COLUMN IF NOT EXISTS wound_id UUID REFERENCES carecore_wounds(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS carecore_body_observations_wound_idx ON carecore_body_observations (wound_id) WHERE wound_id IS NOT NULL;
