-- Kanton bzw. Bundesland der Einrichtung: bestimmt die Feiertage, die der Dienstplan übernehmen kann.
-- Leer bedeutet: nur die landesweiten Feiertage.
ALTER TABLE carecore_organizations ADD COLUMN IF NOT EXISTS region VARCHAR(8);
