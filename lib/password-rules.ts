import { ApiError, type Row } from "@/lib/api-context";
import { passwordPolicyError } from "@/lib/password-policy";
import { resolveSettings } from "@/lib/settings-shared";

type Query = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;

// Mindestlänge neuer Passwörter aus den Einstellungen der Einrichtung, zu der das Konto gehört.
export async function passwordMinLength(sql: Query, userId: string) {
  const rows = (await sql`
    SELECT o.settings->'app' AS app FROM carecore_user_profiles p
    JOIN carecore_organizations o ON o.id = p.organization_id WHERE p.user_id = ${userId}`) as Row[];
  const rule = resolveSettings(rows[0]?.app).passwordMinLength;
  return rule.enabled ? rule.value : null;
}

// Prüft ein neues Passwort gegen die Richtlinie der Einrichtung (orgUserId: das Konto selbst oder, bei einem neuen
// Konto, die Person, die es anlegt).
export async function assertPasswordPolicy(
  sql: Query,
  orgUserId: string,
  password: string,
  who: { username?: string | null; displayName?: string | null },
) {
  const error = passwordPolicyError(password, { minLength: await passwordMinLength(sql, orgUserId), ...who });
  if (error) throw new ApiError(error);
}
