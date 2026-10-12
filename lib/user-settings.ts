import { cookies } from "next/headers";
import { hashPassword, hashSessionToken, SESSION_COOKIE, verifyPassword } from "@/lib/auth";
import { assertPasswordPolicy } from "@/lib/password-rules";
import { ApiError, iso, type Row } from "@/lib/api-context";
import { carecoreDb, hasPermission, type CarecoreActor } from "@/lib/server-data";
import { LANGUAGE_KEYS } from "@/lib/i18n-shared";
import { releasedLanguages } from "@/lib/languages";
import {
  AUTO_LOGOUT_MINUTES,
  DEFAULT_PREFERENCES,
  INSIGHT_PINS_MAX,
  NOTIFY_CATEGORIES,
  START_PAGES,
  TEXT_SIZES,
  isInsightPin,
  resolvePreferences,
  type NotifyCategory,
  type UserPreferences,
  type UserSettings,
} from "@/lib/user-settings-shared";
import { auditOrigin } from "@/lib/audit-origin";
import { deviceLabel } from "@/lib/audit-origin";

// Personal settings of the signed-in person: profile, notifications, appearance,
// password and sessions.

async function currentTokenHash() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? hashSessionToken(token) : null;
}

export async function readPreferences(userId: string): Promise<UserPreferences> {
  const rows = await carecoreDb()`SELECT preferences FROM carecore_user_profiles WHERE user_id = ${userId}`;
  return resolvePreferences(rows[0]?.preferences);
}

// `tokenHash` markiert die aktuelle Sitzung; ohne Angabe wird sie aus dem Sitzungs-Cookie bestimmt.
export async function userSettings(actor: CarecoreActor, tokenHash?: string | null): Promise<UserSettings> {
  const sql = carecoreDb();
  const [profileRows, sessions, currentHash, mfaRows, passkeyRows] = await Promise.all([
    sql`
      SELECT u.display_name, u.username, u.password_changed_at, COALESCE(p.job_title, '') AS job_title,
        COALESCE(p.phone, '') AS phone, p.preferences, cu.name AS care_unit, COALESCE(r.name, u.role) AS role_name
      FROM carecore_users u
      LEFT JOIN carecore_user_profiles p ON p.user_id = u.id
      LEFT JOIN carecore_care_units cu ON cu.id = p.primary_care_unit_id
      LEFT JOIN carecore_roles r ON r.key = u.role
      WHERE u.id = ${actor.id}`,
    sql`
      SELECT id, token_hash, user_agent, created_at, expires_at FROM carecore_sessions
      WHERE user_id = ${actor.id} AND expires_at > NOW() ORDER BY created_at DESC`,
    tokenHash === undefined ? currentTokenHash() : tokenHash,
    sql`SELECT 1 FROM carecore_user_mfa WHERE user_id = ${actor.id} AND confirmed_at IS NOT NULL`,
    sql`SELECT COUNT(*)::int AS n FROM carecore_passkeys WHERE user_id = ${actor.id}`,
  ]);
  const row = (profileRows[0] ?? {}) as Row;
  return {
    profile: {
      displayName: String(row.display_name ?? actor.display_name),
      username: String(row.username ?? actor.username),
      jobTitle: String(row.job_title ?? ""),
      phone: String(row.phone ?? ""),
      roleName: String(row.role_name ?? actor.role),
      permissions: actor.permissions,
      careUnit: row.care_unit ? String(row.care_unit) : null,
    },
    preferences: resolvePreferences(row.preferences),
    security: {
      passwordChangedAt: iso(row.password_changed_at),
      sessions: (sessions as Row[]).map((session) => ({
        id: String(session.id),
        device: deviceLabel(session.user_agent),
        createdAt: iso(session.created_at) ?? "",
        expiresAt: iso(session.expires_at) ?? "",
        current: session.token_hash === currentHash,
      })),
      mfa: (mfaRows as Row[]).length > 0,
      passkeys: Number((passkeyRows as Row[])[0]?.n ?? 0),
    },
  };
}

// Speichert nur die mitgeschickten Felder; ungültige Werte werden abgelehnt statt stillschweigend ersetzt.
export async function savePreferences(actor: CarecoreActor, body: Record<string, unknown>) {
  const current = await readPreferences(actor.id);
  const invalid = (label: string) => new ApiError(`${label}: Wert ist ungültig.`);
  const next: Record<string, unknown> = { ...current };
  if (body.notify !== undefined) {
    if (!body.notify || typeof body.notify !== "object") throw invalid("Benachrichtigungen");
    const input = body.notify as Record<string, unknown>;
    next.notify = Object.fromEntries(
      (Object.keys(NOTIFY_CATEGORIES) as NotifyCategory[]).map((key) => [
        key,
        typeof input[key] === "boolean" ? input[key] : current.notify[key],
      ]),
    );
  }
  const choose = (key: keyof UserPreferences, label: string, allowed: readonly unknown[]) => {
    if (body[key] === undefined) return;
    if (!allowed.includes(body[key])) throw invalid(label);
    next[key] = body[key];
  };
  choose("textSize", "Schriftgrösse", Object.keys(TEXT_SIZES));
  choose("contrast", "Kontrast", ["standard", "high"]);
  choose("motion", "Animationen", ["standard", "reduced"]);
  choose("theme", "Erscheinungsbild", ["light", "dark"]);
  choose("shortcuts", "Tastaturkürzel", [true, false]);
  choose("sound", "Hinweiston", [true, false]);
  choose("dictation", "Spracheingabe", [true, false]);
  // Sprache: freigegebene Sprachen; die Administration darf zum Prüfen auch noch nicht freigegebene wählen.
  if (body.language !== undefined)
    choose(
      "language",
      "Sprache",
      hasPermission(actor, "administration.manage") ? LANGUAGE_KEYS : await releasedLanguages(carecoreDb()),
    );
  choose("startPage", "Startseite", Object.keys(START_PAGES));
  choose("autoLogout", "Automatische Abmeldung", AUTO_LOGOUT_MINUTES);
  if (body.quietHours !== undefined) {
    const input =
      body.quietHours && typeof body.quietHours === "object" ? (body.quietHours as Record<string, unknown>) : null;
    if (!input) throw invalid("Ruhezeit");
    const quiet = { ...current.quietHours, ...input };
    if (
      typeof quiet.enabled !== "boolean" ||
      typeof quiet.critical !== "boolean" ||
      ![quiet.from, quiet.to].every((time) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(time)))
    )
      throw new ApiError("Ruhezeit: Bitte Uhrzeiten im Format HH:MM angeben.");
    if (quiet.enabled && quiet.from === quiet.to)
      throw new ApiError("Ruhezeit: Beginn und Ende müssen sich unterscheiden.");
    next.quietHours = { enabled: quiet.enabled, from: quiet.from, to: quiet.to, critical: quiet.critical };
  }
  if (body.insightPins !== undefined) {
    const pins = body.insightPins;
    if (!Array.isArray(pins) || !pins.every(isInsightPin)) throw invalid("Meine Kennzahlen");
    if (new Set(pins).size > INSIGHT_PINS_MAX)
      throw new ApiError(`Meine Kennzahlen: Höchstens ${INSIGHT_PINS_MAX} Kennzahlen auswählen.`);
    next.insightPins = [...new Set(pins)];
  }
  const resolved = resolvePreferences(next);
  await carecoreDb()`
    UPDATE carecore_user_profiles
    SET preferences = COALESCE(preferences, '{}'::jsonb) || ${JSON.stringify(resolved)}::jsonb, updated_at = NOW()
    WHERE user_id = ${actor.id}`;
  return resolved;
}

// Alle persönlichen Einstellungen auf die Standardwerte zurücksetzen.
export async function resetPreferences(actor: CarecoreActor) {
  await carecoreDb()`
    UPDATE carecore_user_profiles SET preferences = ${JSON.stringify(DEFAULT_PREFERENCES)}::jsonb, updated_at = NOW()
    WHERE user_id = ${actor.id}`;
  return DEFAULT_PREFERENCES;
}

// „Meine Daten herunterladen“: Profil, Einstellungen, Qualifikationen, Geräte, Push-Abonnements (ohne Schlüssel)
// und die eigenen Protokolleinträge der letzten 365 Tage – nur Daten der angemeldeten Person.
export async function exportMyData(actor: CarecoreActor) {
  const sql = carecoreDb();
  const [settings, qualifications, subscriptions, audit, notifications] = await Promise.all([
    userSettings(actor, null),
    sql`
      SELECT q.name, eq.valid_from, eq.valid_until FROM carecore_employee_qualifications eq
      JOIN carecore_qualifications q ON q.id = eq.qualification_id
      WHERE eq.user_id = ${actor.id} ORDER BY eq.valid_from DESC`,
    sql`SELECT created_at, last_sent_at FROM carecore_push_subscriptions WHERE user_id = ${actor.id} ORDER BY created_at DESC`,
    sql`
      SELECT created_at, entity_type, action FROM carecore_audit_log
      WHERE actor_user_id = ${actor.id} AND created_at > NOW() - INTERVAL '365 days'
      ORDER BY created_at DESC LIMIT 5000`,
    sql`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread FROM carecore_notifications WHERE user_id = ${actor.id}`,
  ]);
  return {
    exportedAt: new Date().toISOString(),
    profile: settings.profile,
    preferences: settings.preferences,
    passwordChangedAt: settings.security.passwordChangedAt,
    sessions: settings.security.sessions.map(({ device, createdAt, expiresAt }) => ({ device, createdAt, expiresAt })),
    qualifications: (qualifications as Row[]).map((row) => ({
      name: String(row.name),
      validFrom: iso(row.valid_from)?.slice(0, 10) ?? null,
      validUntil: iso(row.valid_until)?.slice(0, 10) ?? null,
    })),
    pushSubscriptions: (subscriptions as Row[]).map((row) => ({
      createdAt: iso(row.created_at),
      lastSentAt: iso(row.last_sent_at),
    })),
    notifications: { total: Number(notifications[0]?.total ?? 0), unread: Number(notifications[0]?.unread ?? 0) },
    activity: (audit as Row[]).map((row) => ({
      at: iso(row.created_at),
      area: String(row.entity_type),
      action: String(row.action),
    })),
  };
}

// Push-Nachrichten auf allen eigenen Geräten beenden.
export async function endAllPush(actor: CarecoreActor) {
  const rows = await carecoreDb()`DELETE FROM carecore_push_subscriptions WHERE user_id = ${actor.id} RETURNING id`;
  return rows.length;
}

// A new password ends every other session, so a leaked password cannot stay in use elsewhere.
export async function changePassword(actor: CarecoreActor, body: Record<string, unknown>) {
  const currentPassword = typeof body.currentPassword === "string" ? body.currentPassword : "";
  const newPassword = typeof body.newPassword === "string" ? body.newPassword : "";
  if (newPassword === currentPassword) throw new ApiError("Das neue Passwort muss sich vom bisherigen unterscheiden.");
  const sql = carecoreDb();
  await assertPasswordPolicy(sql, actor.id, newPassword, { username: actor.username, displayName: actor.display_name });
  const rows = await sql`SELECT password_hash FROM carecore_users WHERE id = ${actor.id} AND active`;
  if (!rows[0] || !(await verifyPassword(currentPassword, String(rows[0].password_hash))))
    throw new ApiError("Das aktuelle Passwort ist nicht korrekt.", 403);
  const tokenHash = await currentTokenHash();
  await sql.transaction([
    sql`UPDATE carecore_users SET password_hash = ${await hashPassword(newPassword)}, password_changed_at = NOW(), updated_at = NOW()
      WHERE id = ${actor.id}`,
    sql`DELETE FROM carecore_sessions WHERE user_id = ${actor.id} AND token_hash IS DISTINCT FROM ${tokenHash}`,
    sql`INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action)
      VALUES (gen_random_uuid(), ${actor.organizationId ?? null}, ${actor.id}, ${auditOrigin(actor).sessionId}, ${auditOrigin(actor).userAgent}, 'user', ${actor.id}, 'password_changed')`,
  ]);
}

// Signs out other devices: one session by id, or all but the current one.
export async function endSessions(actor: CarecoreActor, sessionId: string | null) {
  const tokenHash = await currentTokenHash();
  const sql = carecoreDb();
  const rows = sessionId
    ? await sql`DELETE FROM carecore_sessions WHERE id = ${sessionId} AND user_id = ${actor.id}
        AND token_hash IS DISTINCT FROM ${tokenHash} RETURNING id`
    : await sql`DELETE FROM carecore_sessions WHERE user_id = ${actor.id} AND token_hash IS DISTINCT FROM ${tokenHash} RETURNING id`;
  return rows.length;
}
