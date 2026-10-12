-- Branding: Logo der Einrichtung (JPEG, PNG oder WebP), angezeigt in der Kopfzeile neben dem Namen.
ALTER TABLE carecore_organizations
  ADD COLUMN IF NOT EXISTS logo_base64 TEXT,
  ADD COLUMN IF NOT EXISTS logo_mime_type VARCHAR(40),
  ADD COLUMN IF NOT EXISTS logo_updated_at TIMESTAMPTZ;
