-- Leistungserfassung: erbrachte Pflegeleistungen mit Zeit je Person. Der Leistungskatalog gehört der Einrichtung
-- (Bezeichnung, eigener Code für den Export, Vorschlag der Minuten); CareCore gibt keine Normzeiten vor.
CREATE TABLE IF NOT EXISTS carecore_service_catalog (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL CHECK (btrim(name) <> ''),
  category VARCHAR(60) NOT NULL,
  code VARCHAR(40) NOT NULL DEFAULT '',
  default_minutes INT CHECK (default_minutes BETWEEN 1 AND 720),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS carecore_service_catalog_name_idx
  ON carecore_service_catalog (organization_id, lower(name));

-- Erfasste Leistungen werden nicht gelöscht, sondern mit Begründung storniert (Grundlage für Einstufung und
-- Abrechnung). Bezeichnung, Bereich und Code werden beim Erfassen übernommen, damit spätere Katalogänderungen
-- erfasste Leistungen nicht verändern.
CREATE TABLE IF NOT EXISTS carecore_service_records (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  care_unit_id UUID REFERENCES carecore_care_units(id) ON DELETE SET NULL,
  catalog_id UUID REFERENCES carecore_service_catalog(id) ON DELETE SET NULL,
  title VARCHAR(160) NOT NULL CHECK (btrim(title) <> ''),
  category VARCHAR(60) NOT NULL,
  code VARCHAR(40) NOT NULL DEFAULT '',
  minutes INT NOT NULL CHECK (minutes BETWEEN 1 AND 720),
  performed_at TIMESTAMPTZ NOT NULL,
  performed_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'task', 'intervention')),
  source_id UUID,
  note TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  cancel_reason TEXT NOT NULL DEFAULT '',
  CHECK (source = 'manual' OR source_id IS NOT NULL),
  CHECK (cancelled_at IS NULL OR btrim(cancel_reason) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_service_records_org_idx ON carecore_service_records (organization_id, performed_at);
CREATE INDEX IF NOT EXISTS carecore_service_records_resident_idx ON carecore_service_records (resident_id, performed_at);
-- Eine erledigte Aufgabe ergibt höchstens eine (nicht stornierte) Leistung.
CREATE UNIQUE INDEX IF NOT EXISTS carecore_service_records_task_idx ON carecore_service_records (source_id)
  WHERE source = 'task' AND cancelled_at IS NULL;
