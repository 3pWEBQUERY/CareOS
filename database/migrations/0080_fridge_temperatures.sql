-- Temperaturprotokoll für Medikamentenkühlschränke. Grenzen und Messrhythmus legt die Einrichtung je Kühlschrank fest;
-- CareCore gibt keine vor. Jede Messung speichert die damals geltenden Grenzen, damit spätere Änderungen den Verlauf
-- nicht umdeuten.
CREATE TABLE IF NOT EXISTS carecore_fridges (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL CHECK (btrim(name) <> ''),
  location VARCHAR(200) NOT NULL DEFAULT '',
  min_celsius NUMERIC(4,1) CHECK (min_celsius BETWEEN -50 AND 60),
  max_celsius NUMERIC(4,1) CHECK (max_celsius BETWEEN -50 AND 60),
  interval_hours SMALLINT CHECK (interval_hours BETWEEN 1 AND 744),
  notes TEXT NOT NULL DEFAULT '',
  retired_at TIMESTAMPTZ,
  retired_reason VARCHAR(500) NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (min_celsius IS NULL OR max_celsius IS NULL OR min_celsius < max_celsius),
  CHECK (retired_at IS NULL OR btrim(retired_reason) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_fridges_org_idx ON carecore_fridges (organization_id, name);

CREATE TABLE IF NOT EXISTS carecore_fridge_readings (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  fridge_id UUID NOT NULL REFERENCES carecore_fridges(id) ON DELETE CASCADE,
  measured_at TIMESTAMPTZ NOT NULL,
  celsius NUMERIC(4,1) NOT NULL CHECK (celsius BETWEEN -50 AND 60),
  min_celsius NUMERIC(4,1),
  max_celsius NUMERIC(4,1),
  outside BOOLEAN NOT NULL DEFAULT FALSE,
  note TEXT NOT NULL DEFAULT '',
  recorded_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (NOT outside OR btrim(note) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_fridge_readings_fridge_idx ON carecore_fridge_readings (fridge_id, measured_at DESC);
