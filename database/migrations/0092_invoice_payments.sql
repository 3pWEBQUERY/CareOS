-- Zahlungseingänge zu Rechnungen: von Hand erfasst oder aus der Bankdatei (camt.054) übernommen. Zahlungen werden nicht
-- gelöscht, sondern mit Grund storniert. Die Bankreferenz verhindert, dass dieselbe Gutschrift zweimal verbucht wird.
CREATE TABLE IF NOT EXISTS carecore_invoice_payments (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES carecore_invoices(id) ON DELETE CASCADE,
  paid_on DATE NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  source VARCHAR(8) NOT NULL CHECK (source IN ('manual', 'bank')),
  bank_reference VARCHAR(140),
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  cancel_reason VARCHAR(2000) NOT NULL DEFAULT '',
  CHECK (cancelled_at IS NULL OR btrim(cancel_reason) <> ''),
  CHECK (source = 'manual' OR bank_reference IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS carecore_invoice_payments_invoice_idx ON carecore_invoice_payments (invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS carecore_invoice_payments_bank_idx
  ON carecore_invoice_payments (organization_id, bank_reference) WHERE bank_reference IS NOT NULL AND cancelled_at IS NULL;
