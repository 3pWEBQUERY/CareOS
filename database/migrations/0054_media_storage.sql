-- Medien im Bucket (Railway Buckets, S3-kompatibel): Ablageschlüssel neben dem bisherigen Inhalt in der Datenbank.
-- Neue Uploads liegen mit eingerichtetem Bucket nur dort; ohne Bucket (lokal, Tests) weiter in der Datenbank.
ALTER TABLE carecore_cloud_files ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE carecore_cloud_files ALTER COLUMN content_base64 DROP NOT NULL;
ALTER TABLE carecore_cloud_files DROP CONSTRAINT IF EXISTS carecore_cloud_files_content_check;
ALTER TABLE carecore_cloud_files ADD CONSTRAINT carecore_cloud_files_content_check
  CHECK (content_base64 IS NOT NULL OR storage_key IS NOT NULL);

ALTER TABLE carecore_wound_photos ADD COLUMN IF NOT EXISTS storage_key TEXT;
ALTER TABLE carecore_wound_photos ALTER COLUMN content DROP NOT NULL;
ALTER TABLE carecore_wound_photos DROP CONSTRAINT IF EXISTS carecore_wound_photos_content_check;
ALTER TABLE carecore_wound_photos ADD CONSTRAINT carecore_wound_photos_content_check
  CHECK (content IS NOT NULL OR storage_key IS NOT NULL);

ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS photo_storage_key TEXT;
ALTER TABLE carecore_organizations ADD COLUMN IF NOT EXISTS logo_storage_key TEXT;
