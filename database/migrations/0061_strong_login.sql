-- Zwei-Faktor-Pflicht: Ist sie in den Einstellungen der Einrichtung eingeschaltet (settings.app.strongLoginRequired),
-- gelten die Leitungs- und Administrationsrechte eines Kontos erst, wenn es Zwei-Faktor-Anmeldung oder einen Passkey
-- eingerichtet hat. carecore_effective_permissions bleibt unverändert (Empfänger von Benachrichtigungen usw.);
-- für den Zugriff gilt carecore_access_permissions.
CREATE OR REPLACE FUNCTION carecore_strong_login_missing(p_user UUID) RETURNS boolean AS $$
  SELECT COALESCE((o.settings->'app'->'strongLoginRequired'->>'enabled')::boolean, FALSE)
    AND (COALESCE(carecore_effective_permissions(p_user), '[]'::jsonb) ?| ARRAY['administration.manage', 'team.manage'])
    AND NOT EXISTS (SELECT 1 FROM carecore_user_mfa m WHERE m.user_id = p_user AND m.confirmed_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM carecore_passkeys k WHERE k.user_id = p_user)
  FROM carecore_user_profiles p
  JOIN carecore_organizations o ON o.id = p.organization_id
  WHERE p.user_id = p_user
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION carecore_access_permissions(p_user UUID) RETURNS jsonb AS $$
  SELECT CASE
    WHEN COALESCE(carecore_strong_login_missing(p_user), FALSE)
      THEN COALESCE(carecore_effective_permissions(p_user), '[]'::jsonb)
        - 'administration.manage' - 'team.manage' - 'schedule.manage' - 'quality.manage' - 'insights.read'
    ELSE COALESCE(carecore_effective_permissions(p_user), '[]'::jsonb)
  END
$$ LANGUAGE sql STABLE;
