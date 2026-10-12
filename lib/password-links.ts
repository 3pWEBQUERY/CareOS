import { createHash, randomBytes } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import "@/database/pg-fetch.mjs";
import { ApiError } from "@/lib/api-context";
import { assertPasswordPolicy } from "@/lib/password-rules";
import { auditOrigin, type AuditActor } from "@/lib/audit-origin";
import { clearFailedLogins, hashPassword } from "@/lib/auth";
import { appBaseUrl, linkMail, mailConfigured, sendMail } from "@/lib/mail";

// Einmalige Links zum Setzen eines Passworts: „Passwort vergessen“ (60 Minuten gültig) und Einladung bzw. Link der
// Administration (7 Tage). Gespeichert wird nur der Hash; ein neuer Link macht ältere ungültig, ein benutzter Link
// lässt sich nicht erneut verwenden. Nach dem Setzen enden alle Sitzungen der Person.

type Purpose = "reset" | "invite";
const VALID_MINUTES: Record<Purpose, number> = { reset: 60, invite: 7 * 24 * 60 };
// Höchstens so viele Links je Person und Stunde über „Passwort vergessen“.
const MAX_RESET_LINKS_PER_HOUR = 3;

type Row = Record<string, unknown>;

function database() {
  const connectionString = process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (!connectionString) throw new Error("DATABASE_URL_NOT_CONFIGURED");
  return neon(connectionString);
}

export const hashLinkToken = (token: string) => createHash("sha256").update(token).digest("hex");

async function createLink(
  sql: ReturnType<typeof database>,
  userId: string,
  purpose: Purpose,
  createdBy: string | null,
) {
  const token = randomBytes(32).toString("base64url");
  await sql.transaction([
    sql`UPDATE carecore_password_links SET used_at = NOW() WHERE user_id = ${userId} AND used_at IS NULL`,
    sql`INSERT INTO carecore_password_links (token_hash, user_id, purpose, created_by, expires_at)
      VALUES (${hashLinkToken(token)}, ${userId}, ${purpose}, ${createdBy},
        NOW() + make_interval(mins => ${VALID_MINUTES[purpose]}))`,
  ]);
  return `${appBaseUrl()}/passwort?token=${encodeURIComponent(token)}`;
}

// „Passwort vergessen“: Benutzername oder E-Mail-Adresse. Die Antwort verrät nie, ob es das Konto gibt.
export async function requestPasswordReset(identifier: string) {
  const key = identifier.trim().toLowerCase().slice(0, 200);
  if (!key || !mailConfigured()) return;
  const sql = database();
  const rows = (await sql`
    SELECT u.id, u.display_name, p.email, p.organization_id,
      (SELECT COUNT(*)::int FROM carecore_password_links l
        WHERE l.user_id = u.id AND l.purpose = 'reset' AND l.created_at > NOW() - INTERVAL '1 hour') AS recent
    FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE u.active AND p.email IS NOT NULL AND (lower(u.username) = ${key} OR lower(p.email) = ${key})
    LIMIT 1`) as Row[];
  const user = rows[0];
  if (!user || Number(user.recent) >= MAX_RESET_LINKS_PER_HOUR) return;
  const url = await createLink(sql, String(user.id), "reset", null);
  await sql`INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, entity_type, entity_id, action)
    VALUES (gen_random_uuid(), ${user.organization_id ?? null}, ${user.id}, 'user', ${user.id}, 'password_reset_requested')`;
  await sendMail({
    to: String(user.email),
    subject: "CareOS: Passwort neu setzen",
    ...linkMail({
      heading: "Passwort neu setzen",
      intro: `Hallo ${String(user.display_name)}, für dein CareOS-Konto wurde ein neues Passwort angefordert.`,
      action: "Neues Passwort setzen",
      url,
      note: "Der Link ist 60 Minuten gültig und nur einmal verwendbar. Hast du nichts angefordert, kannst du diese E-Mail ignorieren; dein Passwort bleibt unverändert.",
    }),
  });
}

// Administration: Link an die hinterlegte E-Mail-Adresse senden (Einladung neuer Mitarbeitender oder neues Passwort).
export async function sendPasswordLink(actor: AuditActor & { id: string }, userId: string) {
  if (!mailConfigured()) throw new ApiError("Der E-Mail-Versand ist nicht eingerichtet.", 409);
  const sql = database();
  const rows = (await sql`
    SELECT u.id, u.username, u.display_name, u.active, p.email, p.organization_id
    FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE u.id = ${userId}
      AND p.organization_id = (SELECT organization_id FROM carecore_user_profiles WHERE user_id = ${actor.id})`) as Row[];
  const user = rows[0];
  if (!user) throw new ApiError("Mitarbeiter ist in dieser Organisation nicht verfügbar.", 404);
  if (!user.active) throw new ApiError("Das Konto ist gesperrt.", 409);
  if (!user.email) throw new ApiError("Für diese Person ist keine E-Mail-Adresse hinterlegt.");
  const url = await createLink(sql, userId, "invite", actor.id);
  const origin = auditOrigin(actor);
  await sql`INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action)
    VALUES (gen_random_uuid(), ${user.organization_id ?? null}, ${actor.id}, ${origin.sessionId}, ${origin.userAgent}, 'user', ${userId}, 'password_link_sent')`;
  await sendMail({
    to: String(user.email),
    subject: "CareOS: Zugang einrichten",
    ...linkMail({
      heading: "Dein Zugang zu CareOS",
      intro: `Hallo ${String(user.display_name)}, die Administration hat dir einen Link zum Setzen deines Passworts geschickt. Dein Benutzername ist „${String(user.username)}“.`,
      action: "Passwort setzen",
      url,
      note: "Der Link ist 7 Tage gültig und nur einmal verwendbar.",
    }),
  });
  return { email: String(user.email) };
}

async function findLink(sql: ReturnType<typeof database>, token: string) {
  if (!token || token.length > 100) return null;
  const rows = (await sql`
    SELECT l.token_hash, l.user_id, l.purpose, u.username, u.display_name, p.organization_id
    FROM carecore_password_links l
    JOIN carecore_users u ON u.id = l.user_id
    LEFT JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE l.token_hash = ${hashLinkToken(token)} AND l.used_at IS NULL AND l.expires_at > NOW() AND u.active`) as Row[];
  return rows[0] ?? null;
}

// Für die Seite „Passwort setzen“: gültig? Dann Benutzername und Anlass.
export async function describePasswordLink(token: string) {
  const link = await findLink(database(), token);
  return link ? { username: String(link.username), purpose: String(link.purpose) as Purpose } : null;
}

export async function completePasswordLink(token: string, password: string) {
  const sql = database();
  const link = await findLink(sql, token);
  if (!link)
    throw new ApiError("Der Link ist abgelaufen oder wurde bereits verwendet. Bitte einen neuen anfordern.", 410);
  await assertPasswordPolicy(sql, String(link.user_id), password, {
    username: String(link.username),
    displayName: link.display_name ? String(link.display_name) : null,
  });
  const passwordHash = await hashPassword(password);
  // Einlösen, Passwort setzen, Sitzungen beenden und protokollieren in einer Anweisung: nur wer den Link als
  // Erste:r einlöst, setzt das Passwort (zweimal gleichzeitig geht nicht).
  const claimed = (await sql`
    WITH claimed AS (
      UPDATE carecore_password_links SET used_at = NOW()
      WHERE token_hash = ${link.token_hash} AND used_at IS NULL AND expires_at > NOW()
      RETURNING user_id
    ), updated AS (
      UPDATE carecore_users SET password_hash = ${passwordHash}, password_changed_at = NOW(), updated_at = NOW()
      WHERE id IN (SELECT user_id FROM claimed) AND active
      RETURNING id
    ), sessions AS (
      DELETE FROM carecore_sessions WHERE user_id IN (SELECT id FROM updated)
    ), audit AS (
      INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, entity_type, entity_id, action)
      SELECT gen_random_uuid(), ${link.organization_id ?? null}::uuid, id, 'user', id, 'password_set_by_link' FROM updated
    )
    SELECT id FROM updated`) as Row[];
  if (!claimed.length) throw new ApiError("Der Link wurde bereits verwendet.", 410);
  await clearFailedLogins(String(link.username));
  return { username: String(link.username) };
}
