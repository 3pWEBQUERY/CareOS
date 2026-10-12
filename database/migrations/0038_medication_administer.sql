-- Medikationsrechte getrennt: „medication.administer“ (Gaben in Runde und Reserve, Wirkungskontrolle,
-- Zweitunterschrift) und „medication.manage“ (Verordnungen, Bestände, BtM-Kontrolle). Jede Rolle mit dem bisherigen
-- Recht erhält beide, damit sich heute nichts ändert; die Einrichtung kann das Verwalten danach gezielt entziehen.
UPDATE carecore_roles SET permissions = permissions || '["medication.administer"]'::jsonb, updated_at = NOW()
WHERE permissions ? 'medication.manage' AND NOT permissions ? 'medication.administer';

-- Verlangt die Rolle eine Qualifikation, fehlen ohne gültige Qualifikation beide Medikationsrechte.
CREATE OR REPLACE FUNCTION carecore_effective_permissions(p_user UUID) RETURNS jsonb AS $$
  SELECT CASE
    WHEN r.medication_requires_qualification
      AND (r.permissions ? 'medication.manage' OR r.permissions ? 'medication.administer')
      AND NOT EXISTS (
        SELECT 1
        FROM carecore_employee_qualifications eq
        JOIN carecore_qualifications q ON q.id = eq.qualification_id AND q.grants_medication
        JOIN carecore_user_profiles p ON p.user_id = eq.user_id AND p.organization_id = q.organization_id
        JOIN carecore_organizations o ON o.id = p.organization_id
        WHERE eq.user_id = u.id
          AND eq.valid_from <= (NOW() AT TIME ZONE COALESCE(o.timezone, 'Europe/Zurich'))::date
          AND (eq.valid_until IS NULL OR eq.valid_until >= (NOW() AT TIME ZONE COALESCE(o.timezone, 'Europe/Zurich'))::date)
      ) THEN r.permissions - 'medication.manage' - 'medication.administer'
    ELSE r.permissions
  END
  FROM carecore_users u
  JOIN carecore_roles r ON r.key = u.role
  WHERE u.id = p_user
$$ LANGUAGE sql STABLE;
