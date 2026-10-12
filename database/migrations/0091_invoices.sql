-- Abrechnung, Rechnungen: Zahlungsangaben der Einrichtung, Rechnungsadresse je Person und Rechnungen je Monat. Eine
-- Rechnung hält die berechneten Positionen fest (sie ändern sich nicht mehr, auch wenn später Taxen geändert werden).
-- Rechnungen werden nicht gelöscht, sondern mit Grund storniert; danach kann der Monat neu verrechnet werden.

ALTER TABLE carecore_billing_settings ADD COLUMN IF NOT EXISTS creditor_name VARCHAR(70);
ALTER TABLE carecore_billing_settings ADD COLUMN IF NOT EXISTS creditor_street VARCHAR(70);
ALTER TABLE carecore_billing_settings ADD COLUMN IF NOT EXISTS creditor_building VARCHAR(16);
ALTER TABLE carecore_billing_settings ADD COLUMN IF NOT EXISTS creditor_zip VARCHAR(16);
ALTER TABLE carecore_billing_settings ADD COLUMN IF NOT EXISTS creditor_city VARCHAR(35);
ALTER TABLE carecore_billing_settings ADD COLUMN IF NOT EXISTS creditor_country CHAR(2);
ALTER TABLE carecore_billing_settings ADD COLUMN IF NOT EXISTS iban VARCHAR(34);
-- Zahlungsfrist in Tagen ab Rechnungsdatum (legt die Einrichtung fest).
ALTER TABLE carecore_billing_settings ADD COLUMN IF NOT EXISTS payment_days INT
  CHECK (payment_days IS NULL OR payment_days BETWEEN 0 AND 120);
-- Nächste Rechnungsnummer (fortlaufend je Einrichtung).
ALTER TABLE carecore_billing_settings ADD COLUMN IF NOT EXISTS next_invoice_number BIGINT NOT NULL DEFAULT 1
  CHECK (next_invoice_number >= 1);

-- An wen die Rechnung für den Anteil der Person geht (die Person selbst, Angehörige, Beistandschaft).
CREATE TABLE IF NOT EXISTS carecore_resident_billing_addresses (
  resident_id UUID PRIMARY KEY REFERENCES carecore_residents(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  name VARCHAR(70) NOT NULL CHECK (btrim(name) <> ''),
  -- Zusatz (z. B. „c/o Beistandschaft“) nur auf der Rechnung, nicht im QR-Code.
  addition VARCHAR(70) NOT NULL DEFAULT '',
  street VARCHAR(70) NOT NULL CHECK (btrim(street) <> ''),
  building VARCHAR(16) NOT NULL DEFAULT '',
  zip VARCHAR(16) NOT NULL CHECK (btrim(zip) <> ''),
  city VARCHAR(35) NOT NULL CHECK (btrim(city) <> ''),
  country CHAR(2) NOT NULL,
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS carecore_invoices (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  month CHAR(7) NOT NULL CHECK (month ~ '^\d{4}-\d{2}$'),
  number BIGINT NOT NULL,
  issued_on DATE NOT NULL,
  due_on DATE NOT NULL,
  currency CHAR(3) NOT NULL,
  -- Festgehaltene Positionen (Anteil der Person) und die ganze Monatsberechnung zur Nachvollziehbarkeit.
  lines JSONB NOT NULL,
  calculation JSONB NOT NULL,
  total_cents BIGINT NOT NULL CHECK (total_cents >= 0),
  -- Empfänger und Zahlungsempfänger zum Zeitpunkt der Rechnung.
  recipient JSONB NOT NULL,
  creditor JSONB NOT NULL,
  reference VARCHAR(27) NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  cancel_reason VARCHAR(2000) NOT NULL DEFAULT '',
  CHECK (due_on >= issued_on),
  CHECK (cancelled_at IS NULL OR btrim(cancel_reason) <> ''),
  UNIQUE (organization_id, number)
);
-- Je Person und Monat höchstens eine gültige Rechnung.
CREATE UNIQUE INDEX IF NOT EXISTS carecore_invoices_month_idx
  ON carecore_invoices (resident_id, month) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS carecore_invoices_org_month_idx ON carecore_invoices (organization_id, month);
