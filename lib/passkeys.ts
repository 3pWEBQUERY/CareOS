import { createHash, randomBytes, randomUUID } from "node:crypto";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransport,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { isoBase64URL } from "@simplewebauthn/server/helpers";
import { ApiError, iso, text, type Row } from "@/lib/api-context";
import { auditOrigin } from "@/lib/audit-origin";
import type { CarecoreActor, carecoreDb } from "@/lib/server-data";

// Passkeys (WebAuthn): Anmeldung mit einem Schlüssel auf dem Gerät. Verlangt wird immer die Bestätigung am Gerät
// (Fingerabdruck, Gesicht oder PIN), deshalb ersetzt ein Passkey Passwort und Code der Zwei-Faktor-Anmeldung.
// Gespeichert wird nur der öffentliche Schlüssel.

type Sql = ReturnType<typeof carecoreDb>;
export type RelyingParty = { rpID: string; origin: string };
export type PasskeySummary = {
  id: string;
  name: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
};

const CHALLENGE_MINUTES = 5;
export const PASSKEYS_MAX = 10;
const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

// Relying Party aus der eigenen Adresse der Anfrage: Passkeys gelten nur für diese Domain.
export function relyingParty(request: Request): RelyingParty {
  const url = new URL(request.url);
  return { rpID: url.hostname, origin: url.origin };
}

function audit(sql: Sql, actor: CarecoreActor, passkeyId: string, action: string, after: unknown = null) {
  const origin = auditOrigin(actor);
  return sql`
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
    VALUES (${randomUUID()}, ${actor.organizationId}, ${actor.id}, ${origin.sessionId}, ${origin.userAgent}, 'user_passkey',
      ${passkeyId}, ${action}, ${after === null ? null : JSON.stringify(after)}::jsonb)`;
}

async function storeChallenge(sql: Sql, purpose: "register" | "login", challenge: string, userId: string | null) {
  const token = randomBytes(32).toString("base64url");
  await sql`DELETE FROM carecore_webauthn_challenges WHERE expires_at <= NOW()`;
  await sql`
    INSERT INTO carecore_webauthn_challenges (token_hash, user_id, purpose, challenge, expires_at)
    VALUES (${tokenHash(token)}, ${userId}, ${purpose}, ${challenge}, NOW() + make_interval(mins => ${CHALLENGE_MINUTES}))`;
  return token;
}

// Einmal verwendbar: die Herausforderung wird beim Einlösen gelöscht.
async function takeChallenge(sql: Sql, purpose: "register" | "login", tokenInput: unknown) {
  const token = typeof tokenInput === "string" ? tokenInput : "";
  if (!token) return null;
  const rows = (await sql`
    DELETE FROM carecore_webauthn_challenges
    WHERE token_hash = ${tokenHash(token)} AND purpose = ${purpose} AND expires_at > NOW()
    RETURNING challenge, user_id`) as Row[];
  return rows[0]
    ? { challenge: String(rows[0].challenge), userId: rows[0].user_id ? String(rows[0].user_id) : null }
    : null;
}

export async function listPasskeys(sql: Sql, userId: string): Promise<PasskeySummary[]> {
  const rows = (await sql`
    SELECT id, name, created_at, last_used_at, backed_up FROM carecore_passkeys
    WHERE user_id = ${userId} ORDER BY created_at`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    createdAt: iso(row.created_at) ?? "",
    lastUsedAt: iso(row.last_used_at),
    backedUp: Boolean(row.backed_up),
  }));
}

// ---------- Registrieren (angemeldet, Einstellungen › Sicherheit) ----------

export async function startRegistration(sql: Sql, actor: CarecoreActor, rp: RelyingParty) {
  const existing = (await sql`
    SELECT credential_id, transports FROM carecore_passkeys WHERE user_id = ${actor.id}`) as Row[];
  if (existing.length >= PASSKEYS_MAX)
    throw new ApiError(`Höchstens ${PASSKEYS_MAX} Passkeys. Bitte zuerst einen entfernen.`);
  const options = await generateRegistrationOptions({
    rpName: "CareOS",
    rpID: rp.rpID,
    userName: actor.username,
    userDisplayName: actor.display_name,
    userID: isoBase64URL.toBuffer(isoBase64URL.fromUTF8String(actor.id)),
    attestationType: "none",
    excludeCredentials: existing.map((row) => ({
      id: String(row.credential_id),
      transports: row.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: { residentKey: "required", userVerification: "required" },
  });
  return { token: await storeChallenge(sql, "register", options.challenge, actor.id), options };
}

export async function finishRegistration(
  sql: Sql,
  actor: CarecoreActor,
  rp: RelyingParty,
  body: { token?: unknown; response?: unknown; name?: unknown },
) {
  const name = text(body.name, 80) || "Passkey";
  const pending = await takeChallenge(sql, "register", body.token);
  if (!pending || pending.userId !== actor.id)
    throw new ApiError("Die Einrichtung ist abgelaufen. Bitte erneut beginnen.", 409);
  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response: body.response as RegistrationResponseJSON,
      expectedChallenge: pending.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
    });
  } catch {
    throw new ApiError("Der Passkey konnte nicht geprüft werden.");
  }
  if (!verification.verified || !verification.registrationInfo)
    throw new ApiError("Der Passkey konnte nicht geprüft werden.");
  const { credential, credentialBackedUp } = verification.registrationInfo;
  const id = randomUUID();
  const taken = (await sql`SELECT 1 FROM carecore_passkeys WHERE credential_id = ${credential.id}`) as Row[];
  if (taken.length) throw new ApiError("Dieser Passkey ist bereits gespeichert.", 409);
  await sql.transaction([
    sql`
      INSERT INTO carecore_passkeys (id, user_id, credential_id, public_key, counter, transports, name, backed_up)
      VALUES (${id}, ${actor.id}, ${credential.id}, ${isoBase64URL.fromBuffer(credential.publicKey)}, ${credential.counter},
        ${credential.transports ?? []}, ${name}, ${credentialBackedUp})`,
    audit(sql, actor, id, "registered", { name }),
  ]);
  return { id, name };
}

export async function removePasskey(sql: Sql, actor: CarecoreActor, passkeyId: unknown) {
  const id = typeof passkeyId === "string" && /^[0-9a-f-]{36}$/i.test(passkeyId) ? passkeyId : "";
  const rows = (await sql`
    SELECT name FROM carecore_passkeys WHERE id = ${id || null} AND user_id = ${actor.id}`) as Row[];
  if (!rows[0]) throw new ApiError("Passkey nicht gefunden.", 404);
  await sql.transaction([
    sql`DELETE FROM carecore_passkeys WHERE id = ${id} AND user_id = ${actor.id}`,
    audit(sql, actor, id, "removed", { name: rows[0].name }),
  ]);
}

// ---------- Anmelden (ohne Sitzung) ----------

// Ohne Benutzername: der Browser bietet die Passkeys dieser Domain an (auch im Feld „Benutzername“).
export async function startLogin(sql: Sql, rp: RelyingParty) {
  const options = await generateAuthenticationOptions({ rpID: rp.rpID, userVerification: "required" });
  return { token: await storeChallenge(sql, "login", options.challenge, null), options };
}

export type PasskeyLogin =
  | { ok: true; user: { id: string; username: string; display_name: string; role: string } }
  | { ok: false; expired?: boolean };

export async function finishLogin(
  sql: Sql,
  rp: RelyingParty,
  body: { token?: unknown; response?: unknown },
): Promise<PasskeyLogin> {
  const pending = await takeChallenge(sql, "login", body.token);
  if (!pending) return { ok: false, expired: true };
  const response = body.response as AuthenticationResponseJSON | undefined;
  if (!response || typeof response.id !== "string") return { ok: false };
  const rows = (await sql`
    SELECT p.id, p.credential_id, p.public_key, p.counter, p.transports,
      u.id AS user_id, u.username, u.display_name, u.role
    FROM carecore_passkeys p JOIN carecore_users u ON u.id = p.user_id
    WHERE p.credential_id = ${response.id} AND u.active = TRUE AND u.archived_at IS NULL`) as Row[];
  const row = rows[0];
  if (!row) return { ok: false };
  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: pending.challenge,
      expectedOrigin: rp.origin,
      expectedRPID: rp.rpID,
      requireUserVerification: true,
      credential: {
        id: String(row.credential_id),
        publicKey: isoBase64URL.toBuffer(String(row.public_key)),
        counter: Number(row.counter),
        transports: row.transports as AuthenticatorTransport[],
      },
    });
  } catch {
    return { ok: false };
  }
  if (!verification.verified) return { ok: false };
  await sql`
    UPDATE carecore_passkeys SET counter = ${verification.authenticationInfo.newCounter}, last_used_at = NOW()
    WHERE id = ${row.id}`;
  return {
    ok: true,
    user: {
      id: String(row.user_id),
      username: String(row.username),
      display_name: String(row.display_name),
      role: String(row.role),
    },
  };
}
