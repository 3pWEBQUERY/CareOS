-- eMediplan: Kennung des Präparats (GTIN bzw. Pharmacode) im eigenen Präparatestamm. Wird beim Übernehmen einer Zeile
-- gemerkt, damit derselbe Code beim nächsten Einlesen dem Präparat zugeordnet ist. Keine Arzneimitteldatenbank.
ALTER TABLE carecore_medications ADD COLUMN IF NOT EXISTS gtin VARCHAR(14);
ALTER TABLE carecore_medications ADD COLUMN IF NOT EXISTS pharmacode VARCHAR(10);
CREATE INDEX IF NOT EXISTS carecore_medications_gtin_idx ON carecore_medications (organization_id, gtin) WHERE gtin IS NOT NULL;
CREATE INDEX IF NOT EXISTS carecore_medications_pharmacode_idx ON carecore_medications (organization_id, pharmacode)
  WHERE pharmacode IS NOT NULL;
