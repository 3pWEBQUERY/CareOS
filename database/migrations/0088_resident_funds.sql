-- Bewohnergelder (Barbetrag, Taschengeld): Konto je Person in der Kasse der Einrichtung. Buchungen werden nicht
-- geändert oder gelöscht, sondern mit Grund storniert. Das Guthaben einer Person kann nicht unter null fallen.
CREATE TABLE IF NOT EXISTS carecore_fund_entries (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  booked_on DATE NOT NULL,
  -- Einzahlung (z. B. von Angehörigen oder der Beistandschaft), Auszahlung an die Person, Ausgabe für die Person.
  kind VARCHAR(10) NOT NULL CHECK (kind IN ('deposit', 'payout', 'expense')),
  amount_cents BIGINT NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000),
  purpose VARCHAR(300) NOT NULL CHECK (btrim(purpose) <> ''),
  party VARCHAR(200) NOT NULL DEFAULT '',
  receipt VARCHAR(60) NOT NULL DEFAULT '',
  author_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  cancel_reason VARCHAR(2000) NOT NULL DEFAULT '',
  CHECK (cancelled_at IS NULL OR btrim(cancel_reason) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_fund_entries_resident_idx ON carecore_fund_entries (resident_id, booked_on);
CREATE INDEX IF NOT EXISTS carecore_fund_entries_org_idx ON carecore_fund_entries (organization_id);

-- Kassenkontrolle: gezählter Bargeldbestand gegen die Summe aller Guthaben zum Zeitpunkt der Zählung.
CREATE TABLE IF NOT EXISTS carecore_fund_counts (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  counted_cents BIGINT NOT NULL CHECK (counted_cents >= 0 AND counted_cents <= 10000000000),
  expected_cents BIGINT NOT NULL,
  witness VARCHAR(200) NOT NULL DEFAULT '',
  note VARCHAR(2000) NOT NULL DEFAULT '',
  counted_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  counted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (counted_cents = expected_cents OR btrim(note) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_fund_counts_org_idx ON carecore_fund_counts (organization_id, counted_at DESC);

-- Eigenes Recht: Geld ist heikler als die Akte. Zu Beginn nur für die Administration; die Einrichtung vergibt es
-- in den Einstellungen weiteren Rollen.
UPDATE carecore_roles SET permissions = permissions || '["funds.manage"]'::jsonb, updated_at = NOW()
WHERE permissions ? 'administration.manage' AND NOT permissions ? 'funds.manage';
