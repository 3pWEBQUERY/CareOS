-- Wäsche- und Inventarliste beim Eintritt: neben Hilfsmitteln und persönlichen Gegenständen auch Kleidung bzw. Wäsche
-- und Einrichtungsgegenstände, jeweils mit Anzahl.
ALTER TABLE carecore_resident_belongings DROP CONSTRAINT IF EXISTS carecore_resident_belongings_kind_check;
ALTER TABLE carecore_resident_belongings ADD CONSTRAINT carecore_resident_belongings_kind_check
  CHECK (kind IN ('aid', 'personal', 'clothing', 'furniture'));
ALTER TABLE carecore_resident_belongings
  ADD COLUMN IF NOT EXISTS quantity SMALLINT NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 999);
