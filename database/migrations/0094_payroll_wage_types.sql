-- Lohn-Export der Zeiterfassung: Lohnarten der Einrichtung. Jede Lohnart nimmt einen Wert der Monatsauswertung
-- (z. B. Ist-Stunden, Nachtstunden, Ferientage) unter der Nummer, die die Lohnbuchhaltung erwartet. CareCore gibt
-- weder Nummern noch Zuschläge vor; die Bewertung (Ansätze, Zuschläge in Franken) bleibt in der Lohnbuchhaltung.
CREATE TABLE IF NOT EXISTS carecore_payroll_wage_types (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  code VARCHAR(20) NOT NULL CHECK (btrim(code) <> ''),
  name VARCHAR(120) NOT NULL CHECK (btrim(name) <> ''),
  source VARCHAR(30) NOT NULL CHECK (source IN ('ACTUAL_HOURS', 'TARGET_HOURS', 'BALANCE_HOURS', 'NIGHT_HOURS',
    'WEEKEND_HOURS', 'HOLIDAY_HOURS', 'VACATION_DAYS', 'SICK_DAYS', 'TRAINING_DAYS', 'OTHER_ABSENCE_DAYS')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT carecore_payroll_wage_types_code_key UNIQUE (organization_id, code)
);
