import { createHash, randomBytes, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { ApiError, type Row } from "@/lib/api-context";
import { auditOrigin } from "@/lib/audit-origin";
import {
  decryptSecret,
  encryptSecret,
  hashRecoveryCode,
  matchTotp,
  mfaKey,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
} from "@/lib/mfa-core";
import { carecoreDb, type CarecoreActor } from "@/lib/server-data";

// Zwei-Faktor-Anmeldung (TOTP) mit Wiederherstellungscodes: Einrichten, Bestätigen, Ausschalten, Codes erneuern
// und die zweite Stufe der Anmeldung. Das Geheimnis liegt verschlüsselt in der Datenbank (CARECORE_MFA_KEY).

type Sql = ReturnType<typeof carecoreDb>;

const ISSUER = "CareOS";
// Gültigkeit einer Anmeldeanfrage nach richtigem Passwort und Zahl der Code-Versuche je Anfrage.
const CHALLENGE_MINUTES = 5;
const CHALLENGE_ATTEMPTS = 5;

export type MfaStatus = {
  available: boolean;
  enabled: boolean;
  pending: boolean;
  recoveryRemaining: number;
};

const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

function requireKey() {
  const key = mfaKey();
  if (!key)
    throw new ApiError(
      "Die Zwei-Faktor-Anmeldung ist auf diesem Server noch nicht eingerichtet (Schlüssel CARECORE_MFA_KEY fehlt).",
      503,
    );
  return key;
}

function audit(sql: Sql, actor: CarecoreActor, userId: string, action: string, after: unknown = null) {
  const origin = auditOrigin(actor);
  return sql`
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
    VALUES (${randomUUID()}, ${actor.organizationId}, ${actor.id}, ${origin.sessionId}, ${origin.userAgent}, 'user_mfa',
      ${userId}, ${action}, ${after === null ? null : JSON.stringify(after)}::jsonb)`;
}

async function loadMfa(sql: Sql, userId: string) {
  return (
    (await sql`
    SELECT secret_encrypted, confirmed_at, last_used_step,
      (SELECT COUNT(*) FROM carecore_mfa_recovery_codes c WHERE c.user_id = m.user_id AND c.used_at IS NULL)::int AS remaining
    FROM carecore_user_mfa m WHERE user_id = ${userId}`) as Row[]
  )[0];
}

export async function mfaStatus(sql: Sql, userId: string): Promise<MfaStatus> {
  const row = await loadMfa(sql, userId);
  return {
    available: mfaKey() !== null,
    enabled: Boolean(row?.confirmed_at),
    pending: Boolean(row && !row.confirmed_at),
    recoveryRemaining: Number(row?.remaining ?? 0),
  };
}

export async function isMfaEnabled(sql: Sql, userId: string) {
  const rows = (await sql`
    SELECT 1 FROM carecore_user_mfa WHERE user_id = ${userId} AND confirmed_at IS NOT NULL`) as Row[];
  return rows.length > 0;
}

// Prüft einen TOTP-Code oder Wiederherstellungscode; verbraucht ihn bei Erfolg. Liefert die Art des Codes.
async function consumeCode(sql: Sql, userId: string, codeInput: unknown): Promise<"totp" | "recovery" | null> {
  const code = typeof codeInput === "string" ? codeInput.trim() : "";
  if (!code) return null;
  const row = await loadMfa(sql, userId);
  if (!row?.confirmed_at) return null;
  const secret = decryptSecret(String(row.secret_encrypted), requireKey());
  const lastUsed = row.last_used_step === null ? null : Number(row.last_used_step);
  const step = matchTotp(secret, code, Date.now(), lastUsed);
  if (step !== null) {
    // Nur ein Gewinner bei gleichzeitiger Verwendung desselben Codes.
    const updated = (await sql`
      UPDATE carecore_user_mfa SET last_used_step = ${step}, updated_at = NOW()
      WHERE user_id = ${userId} AND (last_used_step IS NULL OR last_used_step < ${step}) RETURNING user_id`) as Row[];
    return updated.length ? "totp" : null;
  }
  const used = (await sql`
    UPDATE carecore_mfa_recovery_codes SET used_at = NOW()
    WHERE user_id = ${userId} AND code_hash = ${hashRecoveryCode(code)} AND used_at IS NULL RETURNING id`) as Row[];
  return used.length ? "recovery" : null;
}

// Einrichten beginnen: neues Geheimnis (noch unbestätigt), QR-Code und Schlüssel zum Abtippen.
export async function startEnrollment(sql: Sql, actor: CarecoreActor) {
  const key = requireKey();
  if (await isMfaEnabled(sql, actor.id))
    throw new ApiError("Die Zwei-Faktor-Anmeldung ist bereits eingeschaltet.", 409);
  const secret = newTotpSecret();
  await sql`
    INSERT INTO carecore_user_mfa (user_id, secret_encrypted) VALUES (${actor.id}, ${encryptSecret(secret, key)})
    ON CONFLICT (user_id) DO UPDATE SET secret_encrypted = EXCLUDED.secret_encrypted, confirmed_at = NULL,
      last_used_step = NULL, updated_at = NOW()
    WHERE carecore_user_mfa.confirmed_at IS NULL`;
  const uri = otpauthUri(secret, actor.username, ISSUER);
  const svg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
  return {
    secret: secret.replace(/(.{4})/g, "$1 ").trim(),
    uri,
    qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
  };
}

// Bestätigen mit dem ersten Code aus der App: schaltet ein und liefert einmalig die Wiederherstellungscodes.
export async function confirmEnrollment(sql: Sql, actor: CarecoreActor, codeInput: unknown) {
  const key = requireKey();
  const row = await loadMfa(sql, actor.id);
  if (!row) throw new ApiError("Bitte die Einrichtung zuerst starten.", 409);
  if (row.confirmed_at) throw new ApiError("Die Zwei-Faktor-Anmeldung ist bereits eingeschaltet.", 409);
  const step = matchTotp(
    decryptSecret(String(row.secret_encrypted), key),
    typeof codeInput === "string" ? codeInput : "",
  );
  if (step === null) throw new ApiError("Der Code stimmt nicht. Bitte den aktuellen Code aus der App eingeben.");
  const codes = newRecoveryCodes();
  await sql.transaction([
    sql`
      UPDATE carecore_user_mfa SET confirmed_at = NOW(), last_used_step = ${step}, updated_at = NOW()
      WHERE user_id = ${actor.id} AND confirmed_at IS NULL`,
    sql`DELETE FROM carecore_mfa_recovery_codes WHERE user_id = ${actor.id}`,
    ...codes.map(
      (code) =>
        sql`INSERT INTO carecore_mfa_recovery_codes (user_id, code_hash) VALUES (${actor.id}, ${hashRecoveryCode(code)})`,
    ),
    audit(sql, actor, actor.id, "enabled"),
  ]);
  return { recoveryCodes: codes };
}

// Ausschalten oder Wiederherstellungscodes erneuern: nur mit gültigem Code (App oder Wiederherstellungscode).
export async function disableMfa(sql: Sql, actor: CarecoreActor, codeInput: unknown) {
  if (!(await consumeCode(sql, actor.id, codeInput)))
    throw new ApiError("Der Code stimmt nicht. Bitte einen aktuellen Code oder einen Wiederherstellungscode eingeben.");
  await sql.transaction([
    sql`DELETE FROM carecore_user_mfa WHERE user_id = ${actor.id}`,
    sql`DELETE FROM carecore_mfa_recovery_codes WHERE user_id = ${actor.id}`,
    audit(sql, actor, actor.id, "disabled"),
  ]);
}

export async function regenerateRecoveryCodes(sql: Sql, actor: CarecoreActor, codeInput: unknown) {
  if (!(await consumeCode(sql, actor.id, codeInput)))
    throw new ApiError("Der Code stimmt nicht. Bitte einen aktuellen Code aus der App eingeben.");
  const codes = newRecoveryCodes();
  await sql.transaction([
    sql`DELETE FROM carecore_mfa_recovery_codes WHERE user_id = ${actor.id}`,
    ...codes.map(
      (code) =>
        sql`INSERT INTO carecore_mfa_recovery_codes (user_id, code_hash) VALUES (${actor.id}, ${hashRecoveryCode(code)})`,
    ),
    audit(sql, actor, actor.id, "recovery_regenerated"),
  ]);
  return { recoveryCodes: codes };
}

// Administration: Zwei-Faktor-Anmeldung einer Person zurücksetzen (z. B. Gerät verloren, keine Codes mehr).
export async function resetMfa(sql: Sql, actor: CarecoreActor, userId: string) {
  const rows = (await sql`
    SELECT 1 FROM carecore_user_profiles WHERE user_id = ${userId} AND organization_id = ${actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Person nicht gefunden.", 404);
  await sql.transaction([
    sql`DELETE FROM carecore_user_mfa WHERE user_id = ${userId}`,
    sql`DELETE FROM carecore_mfa_recovery_codes WHERE user_id = ${userId}`,
    sql`DELETE FROM carecore_mfa_challenges WHERE user_id = ${userId}`,
    audit(sql, actor, userId, "reset"),
  ]);
}

// Anmeldung, Stufe 1: nach richtigem Passwort eine kurzlebige Anfrage statt einer Sitzung.
export async function createChallenge(sql: Sql, userId: string, userAgent: string | null) {
  const token = randomBytes(32).toString("base64url");
  await sql`DELETE FROM carecore_mfa_challenges WHERE expires_at <= NOW()`;
  await sql`
    INSERT INTO carecore_mfa_challenges (token_hash, user_id, user_agent, expires_at)
    VALUES (${tokenHash(token)}, ${userId}, ${userAgent?.slice(0, 300) ?? null},
      NOW() + make_interval(mins => ${CHALLENGE_MINUTES}))`;
  return token;
}

// Benutzername zur offenen Anfrage (für die Anmeldedrossel vor der Prüfung des Codes).
export async function challengeUsername(sql: Sql, tokenInput: unknown) {
  const token = typeof tokenInput === "string" ? tokenInput : "";
  if (!token) return null;
  const rows = (await sql`
    SELECT u.username FROM carecore_mfa_challenges c JOIN carecore_users u ON u.id = c.user_id
    WHERE c.token_hash = ${tokenHash(token)} AND c.expires_at > NOW()`) as Row[];
  return rows[0] ? String(rows[0].username) : null;
}

// Anmeldung, Stufe 2: Code prüfen. Erfolg löscht die Anfrage und liefert die Person; Fehlversuche sind begrenzt.
export async function completeChallenge(sql: Sql, tokenInput: unknown, codeInput: unknown) {
  const token = typeof tokenInput === "string" ? tokenInput : "";
  if (!token) return { ok: false as const, expired: true };
  const rows = (await sql`
    UPDATE carecore_mfa_challenges SET attempts = attempts + 1
    WHERE token_hash = ${tokenHash(token)} AND expires_at > NOW() AND attempts < ${CHALLENGE_ATTEMPTS}
    RETURNING user_id, user_agent`) as Row[];
  const challenge = rows[0];
  if (!challenge) return { ok: false as const, expired: true };
  const userId = String(challenge.user_id);
  const kind = await consumeCode(sql, userId, codeInput);
  if (!kind) return { ok: false as const, expired: false, userId };
  await sql`DELETE FROM carecore_mfa_challenges WHERE token_hash = ${tokenHash(token)}`;
  return { ok: true as const, userId, userAgent: (challenge.user_agent as string | null) ?? null, kind };
}
