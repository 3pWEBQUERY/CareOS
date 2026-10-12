-- Medication module: allergies, resident-owned reserve stock, stock journal and
-- one documented administration per order and scheduled time.

ALTER TABLE carecore_residents ADD COLUMN IF NOT EXISTS medication_allergies TEXT;

-- Stock rows belong either to a care unit (ward stock) or to a resident (own reserve stock).
ALTER TABLE carecore_medication_stock ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES carecore_organizations(id) ON DELETE CASCADE;
ALTER TABLE carecore_medication_stock ADD COLUMN IF NOT EXISTS resident_id UUID REFERENCES carecore_residents(id) ON DELETE CASCADE;
ALTER TABLE carecore_medication_stock ADD COLUMN IF NOT EXISTS storage_location VARCHAR(160);

UPDATE carecore_medication_stock st
SET organization_id = si.organization_id
FROM carecore_care_units cu
JOIN carecore_sites si ON si.id = cu.site_id
WHERE st.organization_id IS NULL AND cu.id = st.care_unit_id;

UPDATE carecore_medication_stock st
SET organization_id = r.organization_id
FROM carecore_residents r
WHERE st.organization_id IS NULL AND r.id = st.resident_id;

ALTER TABLE carecore_medication_stock ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS carecore_medication_stock_org_idx ON carecore_medication_stock (organization_id, medication_id);
CREATE INDEX IF NOT EXISTS carecore_medication_stock_resident_idx ON carecore_medication_stock (resident_id, medication_id) WHERE resident_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS carecore_medication_stock_movements (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  stock_id UUID REFERENCES carecore_medication_stock(id) ON DELETE SET NULL,
  medication_id UUID NOT NULL REFERENCES carecore_medications(id) ON DELETE CASCADE,
  resident_id UUID REFERENCES carecore_residents(id) ON DELETE CASCADE,
  administration_id UUID REFERENCES carecore_medication_administrations(id) ON DELETE SET NULL,
  delta NUMERIC(12,3) NOT NULL CHECK (delta <> 0),
  reason VARCHAR(32) NOT NULL CHECK (reason IN ('receipt', 'administration', 'correction', 'disposal')),
  note TEXT,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS carecore_medication_stock_movements_org_idx ON carecore_medication_stock_movements (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS carecore_medication_stock_movements_resident_idx ON carecore_medication_stock_movements (resident_id, created_at DESC) WHERE resident_id IS NOT NULL;

-- A scheduled dose can only be documented once.
CREATE UNIQUE INDEX IF NOT EXISTS carecore_medication_administrations_order_slot_idx ON carecore_medication_administrations (medication_order_id, scheduled_at);
CREATE INDEX IF NOT EXISTS carecore_medication_administrations_resident_time_idx ON carecore_medication_administrations (resident_id, administered_at DESC) WHERE status = 'administered';
