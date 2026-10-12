-- Durchführungsnachweis nach Abweichungen: Massnahmen der Pflegeplanung erhalten optional Tageszeiten (wie die
-- Medikamentenrunden). Je Person und Tageszeit bestätigt eine Pflegeperson „wie geplant“; nur Abweichungen werden mit
-- Grund einzeln erfasst (und als Eintrag in der Pflegedokumentation festgehalten). Nachweise werden nicht gelöscht,
-- sondern mit Grund storniert.
ALTER TABLE carecore_interventions ADD COLUMN IF NOT EXISTS day_parts TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE carecore_interventions DROP CONSTRAINT IF EXISTS carecore_interventions_day_parts_check;
ALTER TABLE carecore_interventions ADD CONSTRAINT carecore_interventions_day_parts_check
  CHECK (day_parts <@ ARRAY['morning', 'noon', 'evening', 'night']::TEXT[]);

CREATE TABLE IF NOT EXISTS carecore_intervention_proofs (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  resident_id UUID NOT NULL REFERENCES carecore_residents(id) ON DELETE CASCADE,
  intervention_id UUID NOT NULL REFERENCES carecore_interventions(id) ON DELETE CASCADE,
  -- Tag und Tageszeit, für die nachgewiesen wird (die Nacht gehört zum Tag, an dem sie beginnt).
  proof_date DATE NOT NULL,
  day_part VARCHAR(16) NOT NULL CHECK (day_part IN ('morning', 'noon', 'evening', 'night')),
  outcome VARCHAR(16) NOT NULL CHECK (outcome IN ('done', 'partial', 'not_done')),
  reason TEXT NOT NULL DEFAULT '',
  -- Eintrag in der Pflegedokumentation zur Abweichung.
  documentation_entry_id UUID REFERENCES carecore_documentation_entries(id) ON DELETE SET NULL,
  author_user_id UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  cancel_reason TEXT NOT NULL DEFAULT '',
  CHECK (outcome = 'done' OR btrim(reason) <> ''),
  CHECK (cancelled_at IS NULL OR btrim(cancel_reason) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS carecore_intervention_proofs_slot_idx
  ON carecore_intervention_proofs (intervention_id, proof_date, day_part) WHERE cancelled_at IS NULL;
CREATE INDEX IF NOT EXISTS carecore_intervention_proofs_resident_idx
  ON carecore_intervention_proofs (resident_id, proof_date DESC);
