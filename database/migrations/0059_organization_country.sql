-- Land der Einrichtung (Schweiz, Deutschland, Österreich): bestimmt Pflegestufen, Sozialversicherungsnummer,
-- Feiertage und vorgeschlagene Qualifikationen. Bestehende Einrichtungen bleiben in der Schweiz; country_set_at
-- hält fest, wann die Administration das Land bestätigt hat (Checkliste der Ersteinrichtung).
ALTER TABLE carecore_organizations
  ADD COLUMN IF NOT EXISTS country CHAR(2) NOT NULL DEFAULT 'CH',
  ADD COLUMN IF NOT EXISTS country_set_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'carecore_organizations_country_check') THEN
    ALTER TABLE carecore_organizations
      ADD CONSTRAINT carecore_organizations_country_check CHECK (country IN ('CH', 'DE', 'AT'));
  END IF;
END $$;
