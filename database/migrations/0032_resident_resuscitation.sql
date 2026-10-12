-- Reanimationsstatus der Bewohnerin / des Bewohners: Entscheid, Grundlage (z. B. Patientenverfügung) und Datum.
-- Ohne Eintrag gilt der Status als „nicht erfasst“; es gibt bewusst keinen Standardwert.
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS resuscitation_status VARCHAR(12);
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS resuscitation_source VARCHAR(200);
ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS resuscitation_decided_on DATE;
ALTER TABLE carecore_residents DROP CONSTRAINT IF EXISTS carecore_residents_resuscitation_check;
ALTER TABLE carecore_residents ADD CONSTRAINT carecore_residents_resuscitation_check CHECK (
  (resuscitation_status IS NULL AND resuscitation_source IS NULL AND resuscitation_decided_on IS NULL)
  OR (resuscitation_status IN ('full', 'dnr') AND resuscitation_source IS NOT NULL)
);
