-- Wirkungskontrolle nach Reservegabe: Termin aus der Verordnung (dosage.effectCheckMinutes), Ergebnis und Erinnerung.
ALTER TABLE carecore_medication_administrations ADD COLUMN IF NOT EXISTS effect_check_due_at TIMESTAMPTZ;
ALTER TABLE carecore_medication_administrations ADD COLUMN IF NOT EXISTS effect_checked_at TIMESTAMPTZ;
ALTER TABLE carecore_medication_administrations ADD COLUMN IF NOT EXISTS effect_checked_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_medication_administrations ADD COLUMN IF NOT EXISTS effect_result VARCHAR(12);
ALTER TABLE carecore_medication_administrations ADD COLUMN IF NOT EXISTS effect_note TEXT;
ALTER TABLE carecore_medication_administrations ADD COLUMN IF NOT EXISTS effect_reminded_at TIMESTAMPTZ;
ALTER TABLE carecore_medication_administrations DROP CONSTRAINT IF EXISTS carecore_med_admin_effect_check;
ALTER TABLE carecore_medication_administrations ADD CONSTRAINT carecore_med_admin_effect_check CHECK (
  (effect_result IS NULL AND effect_checked_at IS NULL)
  OR (effect_result IN ('effective', 'partial', 'none') AND effect_checked_at IS NOT NULL AND effect_check_due_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS carecore_med_admin_effect_due_idx
  ON carecore_medication_administrations (effect_check_due_at) WHERE effect_check_due_at IS NOT NULL AND effect_checked_at IS NULL;
