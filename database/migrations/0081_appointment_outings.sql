-- Termine ausser Haus (Arzt, Spital, Coiffeur, Fusspflege …) mit Transport, Abholung, Begleitung und mitzugebenden
-- Unterlagen; Abfahrt und Rückkehr vermerkt der Empfang bzw. die Pflege in der Tagesliste.
ALTER TABLE carecore_resident_appointments
  ADD COLUMN IF NOT EXISTS outside BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS transport VARCHAR(24)
    CHECK (transport IN ('none', 'family', 'taxi', 'patient_transport', 'facility', 'other')),
  ADD COLUMN IF NOT EXISTS transport_note VARCHAR(300) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pickup_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS escort VARCHAR(200) NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS documents TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS departed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS departed_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS returned_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS returned_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
ALTER TABLE carecore_resident_appointments DROP CONSTRAINT IF EXISTS carecore_appointment_outside_check;
ALTER TABLE carecore_resident_appointments ADD CONSTRAINT carecore_appointment_outside_check CHECK (
  (outside AND kind = 'resident') OR (NOT outside AND transport IS NULL AND pickup_at IS NULL AND departed_at IS NULL)
);
ALTER TABLE carecore_resident_appointments DROP CONSTRAINT IF EXISTS carecore_appointment_return_check;
ALTER TABLE carecore_resident_appointments ADD CONSTRAINT carecore_appointment_return_check CHECK (
  returned_at IS NULL OR (departed_at IS NOT NULL AND returned_at >= departed_at)
);
CREATE INDEX IF NOT EXISTS carecore_appointments_outside_idx
  ON carecore_resident_appointments (organization_id, starts_at) WHERE outside;
