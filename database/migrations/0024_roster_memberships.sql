-- Dienstplan: Mitarbeitende mit Wohnbereich sind dort planbar.
-- 0023 hat nur die damals vorhandenen Stammwohnbereiche übernommen; Zuordnungen aus
-- carecore_user_unit_assignments und später angelegte Personen fehlten im Dienstplan.

INSERT INTO carecore_unit_memberships (user_id, care_unit_id, plannable, is_lead)
SELECT p.user_id, p.primary_care_unit_id, TRUE, FALSE
FROM carecore_user_profiles p
JOIN carecore_users u ON u.id = p.user_id AND u.active
WHERE p.primary_care_unit_id IS NOT NULL
ON CONFLICT (user_id, care_unit_id) DO UPDATE SET plannable = TRUE;

INSERT INTO carecore_unit_memberships (user_id, care_unit_id, plannable, is_lead)
SELECT a.user_id, a.care_unit_id, TRUE, FALSE
FROM carecore_user_unit_assignments a
JOIN carecore_users u ON u.id = a.user_id AND u.active
WHERE a.ends_on IS NULL OR a.ends_on >= CURRENT_DATE
ON CONFLICT (user_id, care_unit_id) DO UPDATE SET plannable = TRUE;

INSERT INTO carecore_employee_profiles (user_id)
SELECT DISTINCT m.user_id FROM carecore_unit_memberships m WHERE m.plannable
ON CONFLICT (user_id) DO NOTHING;

-- Neue Zuordnungen (bzw. ein geänderter Stammwohnbereich) machen die Person im Wohnbereich planbar. Entfernen bleibt
-- bewusst der Leitung überlassen (Einstellungen › Personal), damit geplante Dienste nicht verwaisen.
CREATE OR REPLACE FUNCTION carecore_roster_membership_from_profile() RETURNS trigger AS $$
BEGIN
  IF NEW.primary_care_unit_id IS NOT NULL
    AND (TG_OP = 'INSERT' OR NEW.primary_care_unit_id IS DISTINCT FROM OLD.primary_care_unit_id) THEN
    INSERT INTO carecore_unit_memberships (user_id, care_unit_id, plannable, is_lead)
    VALUES (NEW.user_id, NEW.primary_care_unit_id, TRUE, FALSE)
    ON CONFLICT (user_id, care_unit_id) DO UPDATE SET plannable = TRUE;
    INSERT INTO carecore_employee_profiles (user_id) VALUES (NEW.user_id) ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carecore_roster_membership_profile ON carecore_user_profiles;
CREATE TRIGGER carecore_roster_membership_profile
AFTER INSERT OR UPDATE OF primary_care_unit_id ON carecore_user_profiles
FOR EACH ROW EXECUTE FUNCTION carecore_roster_membership_from_profile();

CREATE OR REPLACE FUNCTION carecore_roster_membership_from_assignment() RETURNS trigger AS $$
BEGIN
  IF NEW.ends_on IS NULL OR NEW.ends_on >= CURRENT_DATE THEN
    INSERT INTO carecore_unit_memberships (user_id, care_unit_id, plannable, is_lead)
    VALUES (NEW.user_id, NEW.care_unit_id, TRUE, FALSE)
    ON CONFLICT (user_id, care_unit_id) DO UPDATE SET plannable = TRUE;
    INSERT INTO carecore_employee_profiles (user_id) VALUES (NEW.user_id) ON CONFLICT (user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS carecore_roster_membership_assignment ON carecore_user_unit_assignments;
CREATE TRIGGER carecore_roster_membership_assignment
AFTER INSERT ON carecore_user_unit_assignments
FOR EACH ROW EXECUTE FUNCTION carecore_roster_membership_from_assignment();
