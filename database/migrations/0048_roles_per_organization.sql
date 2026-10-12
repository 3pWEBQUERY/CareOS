-- Eigene Rollen gehören der Einrichtung, die sie angelegt hat: nur sie sieht, vergibt, ändert und löscht sie.
-- Eingebaute Systemrollen (system_role) bleiben ohne Einrichtung und gelten für alle.
ALTER TABLE carecore_roles
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES carecore_organizations(id) ON DELETE CASCADE;

-- Bestehende eigene Rollen: Einrichtung der Person, die sie angelegt hat …
UPDATE carecore_roles r SET organization_id = p.organization_id
FROM carecore_user_profiles p
WHERE r.system_role = FALSE AND r.organization_id IS NULL AND p.user_id = r.created_by AND p.organization_id IS NOT NULL;

-- … sonst die Einrichtung der Personen mit dieser Rolle, wenn es genau eine ist. Übrige bleiben ohne Einrichtung:
-- bestehende Zuweisungen gelten weiter, die Rolle erscheint aber in keiner Einrichtung zur Auswahl.
UPDATE carecore_roles r SET organization_id = holders.organization_id
FROM (
  SELECT u.role, MIN(p.organization_id::text)::uuid AS organization_id
  FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
  WHERE p.organization_id IS NOT NULL
  GROUP BY u.role HAVING COUNT(DISTINCT p.organization_id) = 1
) holders
WHERE r.system_role = FALSE AND r.organization_id IS NULL AND holders.role = r.key;

CREATE INDEX IF NOT EXISTS carecore_roles_organization_idx ON carecore_roles (organization_id);
