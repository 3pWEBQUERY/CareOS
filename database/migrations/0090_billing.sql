-- Abrechnung, Grundlagen: Taxen der Einrichtung mit Preisen ab einem Datum, Pflegestufe je Person mit Verlauf,
-- Abwesenheiten und zusätzliche Taxen je Person. Alle Beträge und Regeln legt die Einrichtung fest; CareCore gibt
-- keine Tarife vor. Nichts wird gelöscht: Preise gelten ab einem Datum, Einträge werden mit Grund storniert.

CREATE TABLE IF NOT EXISTS carecore_billing_rates (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  name VARCHAR(160) NOT NULL CHECK (btrim(name) <> ''),
  -- Pension (Hotellerie), Betreuung, Pflege (je Pflegestufe), weitere Leistungen.
  category VARCHAR(12) NOT NULL CHECK (category IN ('pension', 'support', 'care', 'extra')),
  -- Wer bezahlt: die Person, die Krankenversicherung, die öffentliche Hand (Restfinanzierung) oder andere.
  payer VARCHAR(12) NOT NULL CHECK (payer IN ('resident', 'insurer', 'public', 'other')),
  -- Nur Pflege: gilt an Tagen mit dieser Pflegestufe.
  care_level VARCHAR(80),
  -- Für alle Personen oder nur für Personen, denen die Taxe zugewiesen ist (z. B. Zuschlag Einzelzimmer).
  applies VARCHAR(12) NOT NULL DEFAULT 'all' CHECK (applies IN ('all', 'assigned')),
  -- Abwesenheit (Spital bzw. Ferien und andere): die ersten n Tage voll, danach p Prozent. Ohne Regel: unverändert.
  hospital_full_days INT CHECK (hospital_full_days BETWEEN 0 AND 365),
  hospital_percent INT CHECK (hospital_percent BETWEEN 0 AND 100),
  absence_full_days INT CHECK (absence_full_days BETWEEN 0 AND 365),
  absence_percent INT CHECK (absence_percent BETWEEN 0 AND 100),
  position INT NOT NULL DEFAULT 0,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ,
  CHECK ((category = 'care') = (care_level IS NOT NULL)),
  CHECK (category <> 'care' OR applies = 'all'),
  CHECK ((hospital_full_days IS NULL) = (hospital_percent IS NULL)),
  CHECK ((absence_full_days IS NULL) = (absence_percent IS NULL))
);
CREATE INDEX IF NOT EXISTS carecore_billing_rates_org_idx ON carecore_billing_rates (organization_id);
-- Je Pflegestufe und Kostenträger höchstens ein aktiver Pflegetarif.
CREATE UNIQUE INDEX IF NOT EXISTS carecore_billing_rates_care_idx
  ON carecore_billing_rates (organization_id, care_level, payer) WHERE category = 'care' AND archived_at IS NULL;

-- Preis je Tag ab einem Datum (Preisänderungen sind neue Zeilen; der Verlauf bleibt).
CREATE TABLE IF NOT EXISTS carecore_billing_rate_prices (
  id UUID PRIMARY KEY,
  rate_id UUID NOT NULL REFERENCES carecore_billing_rates(id) ON DELETE CASCADE,
  valid_from DATE NOT NULL,
  amount_cents BIGINT NOT NULL CHECK (amount_cents >= 0 AND amount_cents <= 10000000),
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (rate_id, valid_from)
);

-- Regeln der Einrichtung für die Abrechnung, die nicht an einer einzelnen Taxe hängen.
CREATE TABLE IF NOT EXISTS carecore_billing_settings (
  organization_id UUID PRIMARY KEY REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  -- Ob der Austrittstag (auch Todestag) verrechnet wird; ohne Festlegung (NULL) rechnet CareCore nicht.
  discharge_day_billed BOOLEAN,
  updated_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Pflegestufe je Person ab einem Datum (z. B. nach der Einstufung mit dem vom Kanton anerkannten Instrument).
CREATE TABLE IF NOT EXISTS carecore_resident_care_levels (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  care_level VARCHAR(80) NOT NULL,
  valid_from DATE NOT NULL,
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  cancel_reason VARCHAR(2000) NOT NULL DEFAULT '',
  CHECK (cancelled_at IS NULL OR btrim(cancel_reason) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS carecore_resident_care_levels_day_idx
  ON carecore_resident_care_levels (resident_id, valid_from) WHERE cancelled_at IS NULL;

-- Abwesenheiten: erster und letzter ganzer Tag, an dem die Person nicht im Haus war (offen, solange sie fehlt).
CREATE TABLE IF NOT EXISTS carecore_resident_absences (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  kind VARCHAR(12) NOT NULL CHECK (kind IN ('hospital', 'vacation', 'other')),
  starts_on DATE NOT NULL,
  ends_on DATE,
  note VARCHAR(500) NOT NULL DEFAULT '',
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  cancel_reason VARCHAR(2000) NOT NULL DEFAULT '',
  CHECK (ends_on IS NULL OR ends_on >= starts_on),
  CHECK (cancelled_at IS NULL OR btrim(cancel_reason) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_resident_absences_resident_idx ON carecore_resident_absences (resident_id, starts_on);

-- Zusätzliche Taxen je Person (nur Taxen mit „nur zugewiesene Personen“).
CREATE TABLE IF NOT EXISTS carecore_resident_rates (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  rate_id UUID NOT NULL REFERENCES carecore_billing_rates(id) ON DELETE CASCADE,
  valid_from DATE NOT NULL,
  valid_until DATE,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  cancel_reason VARCHAR(2000) NOT NULL DEFAULT '',
  CHECK (valid_until IS NULL OR valid_until >= valid_from),
  CHECK (cancelled_at IS NULL OR btrim(cancel_reason) <> '')
);
CREATE INDEX IF NOT EXISTS carecore_resident_rates_resident_idx ON carecore_resident_rates (resident_id);

-- Eigenes Recht wie bei den Bewohnergeldern: zu Beginn nur für die Administration.
UPDATE carecore_roles SET permissions = permissions || '["billing.manage"]'::jsonb, updated_at = NOW()
WHERE permissions ? 'administration.manage' AND NOT permissions ? 'billing.manage';
