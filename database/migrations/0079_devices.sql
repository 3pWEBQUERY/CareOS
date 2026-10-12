-- Geräte und Hilfsmittel der Einrichtung (z. B. Pflegebetten, Lifter, Waagen, Blutdruckgeräte) mit Prüfungen. Die Frist
-- bis zur nächsten Prüfung legt die Einrichtung bzw. der Hersteller fest; CareCore gibt keine vor.
CREATE TABLE IF NOT EXISTS carecore_devices (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL CHECK (btrim(name) <> ''),
  category VARCHAR(80) NOT NULL DEFAULT '',
  inventory_number VARCHAR(60) NOT NULL DEFAULT '',
  manufacturer VARCHAR(160) NOT NULL DEFAULT '',
  location VARCHAR(200) NOT NULL DEFAULT '',
  interval_months SMALLINT CHECK (interval_months BETWEEN 1 AND 120),
  next_due_on DATE,
  notes TEXT NOT NULL DEFAULT '',
  retired_at TIMESTAMPTZ,
  retired_reason VARCHAR(500) NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (retired_at IS NULL OR btrim(retired_reason) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_devices_org_idx ON carecore_devices (organization_id, next_due_on);

CREATE TABLE IF NOT EXISTS carecore_device_checks (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  device_id UUID NOT NULL REFERENCES carecore_devices(id) ON DELETE CASCADE,
  checked_on DATE NOT NULL,
  result VARCHAR(8) NOT NULL CHECK (result IN ('ok', 'defect')),
  findings TEXT NOT NULL DEFAULT '',
  performed_by VARCHAR(200) NOT NULL CHECK (btrim(performed_by) <> ''),
  next_due_on DATE,
  recorded_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (result = 'ok' OR btrim(findings) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_device_checks_device_idx ON carecore_device_checks (device_id, checked_on DESC);
