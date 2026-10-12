-- Medikationsrecht: Leitung erhält die Medikation; in der Rolle „Pflege“ nur Personen mit einer Qualifikation,
-- die zur Medikation berechtigt (Standard: Pflegefachperson HF und Fachperson Gesundheit). Weitere Qualifikationen
-- (z. B. Pflegefachperson FH) kann die Einrichtung in den Dienstplan-Einstellungen freischalten.

ALTER TABLE carecore_qualifications ADD COLUMN IF NOT EXISTS grants_medication BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE carecore_qualifications SET grants_medication = TRUE WHERE code IN ('HF', 'FAGE');

ALTER TABLE carecore_roles ADD COLUMN IF NOT EXISTS medication_requires_qualification BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE carecore_roles SET medication_requires_qualification = TRUE WHERE key = 'pflege';

UPDATE carecore_roles SET permissions = permissions || '["medication.manage"]'::jsonb, updated_at = NOW()
WHERE key = 'leitung' AND NOT permissions ? 'medication.manage';

-- Wirksame Berechtigungen einer Person: die ihrer Rolle, ohne Medikation, wenn die Rolle dafür eine Qualifikation
-- verlangt und die Person heute (Zeitzone der Organisation) keine gültige berechtigende Qualifikation hat.
CREATE OR REPLACE FUNCTION carecore_effective_permissions(p_user UUID) RETURNS jsonb AS $$
  SELECT CASE
    WHEN r.medication_requires_qualification AND r.permissions ? 'medication.manage' AND NOT EXISTS (
      SELECT 1
      FROM carecore_employee_qualifications eq
      JOIN carecore_qualifications q ON q.id = eq.qualification_id AND q.grants_medication
      JOIN carecore_user_profiles p ON p.user_id = eq.user_id AND p.organization_id = q.organization_id
      JOIN carecore_organizations o ON o.id = p.organization_id
      WHERE eq.user_id = u.id
        AND eq.valid_from <= (NOW() AT TIME ZONE COALESCE(o.timezone, 'Europe/Zurich'))::date
        AND (eq.valid_until IS NULL OR eq.valid_until >= (NOW() AT TIME ZONE COALESCE(o.timezone, 'Europe/Zurich'))::date)
    ) THEN r.permissions - 'medication.manage'
    ELSE r.permissions
  END
  FROM carecore_users u
  JOIN carecore_roles r ON r.key = u.role
  WHERE u.id = p_user
$$ LANGUAGE sql STABLE;
