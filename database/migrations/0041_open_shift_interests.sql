-- Dienstplan: Börse für offene Dienste. Offen ist ein Dienst, wenn die Mindestbesetzung (Diensttyp, Tag,
-- Wohnbereich) im veröffentlichten Plan nicht erreicht ist. Mitarbeitende melden Interesse, die Leitung teilt
-- zu (der Dienst entsteht über die Regelprüfung des Dienstplans) oder lehnt ab.

CREATE TABLE IF NOT EXISTS carecore_open_shift_interests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  care_unit_id UUID NOT NULL REFERENCES carecore_care_units(id) ON DELETE CASCADE,
  shift_type_id UUID NOT NULL REFERENCES carecore_shift_types(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  employee_id UUID NOT NULL REFERENCES carecore_users(id) ON DELETE CASCADE,
  status VARCHAR(12) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'ASSIGNED', 'DECLINED', 'WITHDRAWN', 'CLOSED')),
  message VARCHAR(500),
  roster_shift_id UUID REFERENCES carecore_roster_shifts(id) ON DELETE SET NULL,
  decision_comment VARCHAR(500),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS carecore_open_shift_interest_one_open
  ON carecore_open_shift_interests (care_unit_id, shift_type_id, date, employee_id) WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS carecore_open_shift_interests_slot_idx
  ON carecore_open_shift_interests (care_unit_id, date, shift_type_id);
CREATE INDEX IF NOT EXISTS carecore_open_shift_interests_employee_idx
  ON carecore_open_shift_interests (employee_id, created_at DESC);
