-- Vorlagen für die Pflegeplanung: Standardpläne (Problem, Ressourcen, Ziel, Überprüfungsfrist, Massnahmen) und ein
-- Massnahmenkatalog der Einrichtung. CareCore gibt keine Inhalte vor. Übernommen wird immer eine Kopie, die bei der
-- Person angepasst wird; spätere Änderungen an der Vorlage ändern bestehende Pflegepläne nicht.
CREATE TABLE IF NOT EXISTS carecore_care_goal_templates (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  category VARCHAR(100) NOT NULL,
  title VARCHAR(160) NOT NULL CHECK (btrim(title) <> ''),
  problem TEXT NOT NULL CHECK (btrim(problem) <> ''),
  resources TEXT NOT NULL DEFAULT '',
  statement TEXT NOT NULL CHECK (btrim(statement) <> ''),
  -- Überprüfung nach so vielen Tagen (ohne Angabe wählt die Fachperson das Datum selbst).
  review_days INT CHECK (review_days IS NULL OR review_days BETWEEN 1 AND 365),
  -- Massnahmen [{ title, instructions, frequency, responsibleRole, dayParts }].
  interventions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS carecore_care_goal_templates_org_idx ON carecore_care_goal_templates (organization_id);

CREATE TABLE IF NOT EXISTS carecore_intervention_templates (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES carecore_organizations(id) ON DELETE CASCADE,
  category VARCHAR(100) NOT NULL,
  title VARCHAR(220) NOT NULL CHECK (btrim(title) <> ''),
  instructions TEXT NOT NULL DEFAULT '',
  frequency VARCHAR(100) NOT NULL CHECK (btrim(frequency) <> ''),
  responsible_role VARCHAR(100),
  day_parts TEXT[] NOT NULL DEFAULT '{}' CHECK (day_parts <@ ARRAY['morning', 'noon', 'evening', 'night']::TEXT[]),
  created_by UUID REFERENCES carecore_users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS carecore_intervention_templates_org_idx ON carecore_intervention_templates (organization_id);

-- Herkunft eines Ziels (nur zur Nachvollziehbarkeit).
ALTER TABLE carecore_care_goals ADD COLUMN IF NOT EXISTS template_id UUID
  REFERENCES carecore_care_goal_templates(id) ON DELETE SET NULL;
