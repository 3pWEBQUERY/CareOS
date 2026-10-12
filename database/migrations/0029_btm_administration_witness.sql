-- Optionale Zweitunterschrift bei der Gabe von Betäubungsmitteln (Einstellung „Zweitunterschrift bei BtM-Gaben“).
ALTER TABLE carecore_medication_administrations
  ADD COLUMN IF NOT EXISTS witness_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL;
