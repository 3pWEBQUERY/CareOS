import { createHash, randomUUID } from "node:crypto";
import * as oidc from "openid-client";
import { ApiError, auditStatement, iso, text, type ApiContext, type Row, type Sql } from "@/lib/api-context";
import { decryptSecret, encryptSecret, mfaKey } from "@/lib/mfa-core";
import { hasPermission } from "@/lib/server-data";
import { SSO_CLAIMS, type SsoClaim, type SsoSettings } from "@/lib/sso-shared";

// SSO über OpenID Connect (Open Source: openid-client, MIT). Authorization Code mit PKCE, state und nonce; das
// ID-Token wird geprüft (Signatur, Aussteller, Empfänger, Ablauf, nonce). Angemeldet werden nur bestehende, aktive
// Konten der Einrichtung, deren Benutzername dem gewählten Claim entspricht – es entstehen keine Konten automatisch.
// Die Zwei-Faktor-Anmeldung übernimmt dabei der Identity-Provider.

const REQUEST_MINUTES = 10;
const stateHash = (state: string) => createHash("sha256").update(state).digest("hex");
// Unverschlüsselt nur für den lokalen Test-Anbieter: Schalter gesetzt und Adresse auf diesem Rechner.
const allowHttp = (url: URL) =>
  process.env.CARECORE_SSO_ALLOW_HTTP === "1" && ["localhost", "127.0.0.1"].includes(url.hostname);

export const ssoRedirectUri = (origin: string) => `${origin}/api/auth/sso/callback`;

function requireAdmin(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "administration.manage"))
    throw new ApiError("SSO richtet die Administration ein.", 403);
}

function requireKey() {
  const key = mfaKey();
  if (!key) throw new ApiError("SSO braucht den Serverschlüssel CARECORE_MFA_KEY. Bitte beim Betrieb einrichten.", 503);
  return key;
}

function validIssuer(input: unknown) {
  const raw = text(input, 300);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ApiError("Bitte die Adresse des Identity-Providers angeben (https://…).");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && allowHttp(url)))
    throw new ApiError("Der Identity-Provider muss über https erreichbar sein.");
  if (url.username || url.password || url.search || url.hash)
    throw new ApiError("Die Adresse des Identity-Providers ist ungültig.");
  return url.toString().replace(/\/$/, "");
}

const mapSettings = (row: Row | undefined): SsoSettings => ({
  enabled: Boolean(row?.enabled),
  issuer: row ? String(row.issuer) : "",
  clientId: row ? String(row.client_id) : "",
  hasSecret: Boolean(row?.client_secret_encrypted),
  usernameClaim: (row?.username_claim as SsoClaim) ?? "preferred_username",
  buttonLabel: row ? String(row.button_label) : "SSO",
  updatedAt: iso(row?.updated_at),
});

export async function readSsoSettings(ctx: ApiContext) {
  requireAdmin(ctx);
  const rows = (await ctx.sql`
    SELECT * FROM carecore_sso_settings WHERE organization_id = ${ctx.actor.organizationId}`) as Row[];
  return mapSettings(rows[0]);
}

// { enabled, issuer, clientId, clientSecret?, usernameClaim, buttonLabel } – ohne clientSecret bleibt das bisherige.
export async function saveSsoSettings(ctx: ApiContext, body: Record<string, unknown>) {
  requireAdmin(ctx);
  const key = requireKey();
  const issuer = validIssuer(body.issuer);
  const clientId = text(body.clientId, 200);
  if (!clientId) throw new ApiError("Bitte die Client-ID angeben.");
  const usernameClaim = (
    typeof body.usernameClaim === "string" && body.usernameClaim in SSO_CLAIMS ? body.usernameClaim : null
  ) as SsoClaim | null;
  if (!usernameClaim) throw new ApiError("Bitte wählen, welcher Claim dem Benutzernamen entspricht.");
  const buttonLabel = text(body.buttonLabel, 60) || "SSO";
  const secret = typeof body.clientSecret === "string" ? body.clientSecret.trim().slice(0, 500) : "";
  const enabled = body.enabled === true;
  const before = await readSsoSettings(ctx);
  if (enabled && !secret && !before.hasSecret) throw new ApiError("Bitte das Client-Secret angeben.");
  const encrypted = secret ? encryptSecret(secret, key) : null;
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_sso_settings (organization_id, enabled, issuer, client_id, client_secret_encrypted,
        username_claim, button_label, updated_by, updated_at)
      VALUES (${ctx.actor.organizationId}, ${enabled}, ${issuer}, ${clientId}, ${encrypted}, ${usernameClaim},
        ${buttonLabel}, ${ctx.actor.id}, NOW())
      ON CONFLICT (organization_id) DO UPDATE SET enabled = EXCLUDED.enabled, issuer = EXCLUDED.issuer,
        client_id = EXCLUDED.client_id,
        client_secret_encrypted = COALESCE(EXCLUDED.client_secret_encrypted, carecore_sso_settings.client_secret_encrypted),
        username_claim = EXCLUDED.username_claim, button_label = EXCLUDED.button_label,
        updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    auditStatement(
      ctx,
      "sso",
      ctx.actor.organizationId,
      "sso_settings_saved",
      { enabled: before.enabled, issuer: before.issuer, clientId: before.clientId },
      { enabled, issuer, clientId, usernameClaim, buttonLabel, secretChanged: Boolean(secret) },
    ),
  ]);
  return readSsoSettings(ctx);
}

async function configuration(row: Row) {
  const secret = row.client_secret_encrypted ? decryptSecret(String(row.client_secret_encrypted), requireKey()) : "";
  const issuer = new URL(String(row.issuer));
  return oidc.discovery(
    issuer,
    String(row.client_id),
    secret,
    undefined,
    issuer.protocol === "http:" && allowHttp(issuer) ? { execute: [oidc.allowInsecureRequests] } : undefined,
  );
}

// Verbindung prüfen: Discovery-Dokument des Identity-Providers laden.
export async function testSsoConnection(ctx: ApiContext) {
  requireAdmin(ctx);
  const rows = (await ctx.sql`
    SELECT * FROM carecore_sso_settings WHERE organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("SSO ist noch nicht eingerichtet.");
  try {
    const config = await configuration(rows[0]);
    return { ok: true, issuer: config.serverMetadata().issuer };
  } catch (cause) {
    throw new ApiError(
      `Der Identity-Provider antwortet nicht wie erwartet: ${(cause as Error).message}`.slice(0, 300),
      502,
    );
  }
}

// Anmeldeseite: eingeschaltete Anbieter (nur Bezeichnung und Kennung).
export async function ssoProviders(sql: Sql) {
  const rows = (await sql`
    SELECT organization_id, button_label FROM carecore_sso_settings
    WHERE enabled AND client_secret_encrypted IS NOT NULL ORDER BY button_label`) as Row[];
  return rows.map((row) => ({ id: String(row.organization_id), label: String(row.button_label) }));
}

async function enabledSettings(sql: Sql, organizationId: string) {
  const rows = (await sql`
    SELECT * FROM carecore_sso_settings
    WHERE organization_id = ${organizationId} AND enabled AND client_secret_encrypted IS NOT NULL`) as Row[];
  return rows[0] ?? null;
}

const safeNext = (value: unknown) =>
  typeof value === "string" && /^\/c(\/[\w\-./%?=&]*)?$/.test(value) && !value.includes("//") ? value : null;

// Beginn: Adresse beim Identity-Provider (mit PKCE, state, nonce).
export async function startSso(sql: Sql, organizationId: unknown, origin: string, next: unknown) {
  if (typeof organizationId !== "string" || !/^[0-9a-f-]{36}$/i.test(organizationId))
    throw new ApiError("SSO-Anbieter nicht gefunden.", 404);
  const row = await enabledSettings(sql, organizationId);
  if (!row) throw new ApiError("SSO-Anbieter nicht gefunden.", 404);
  const config = await configuration(row);
  const codeVerifier = oidc.randomPKCECodeVerifier();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  await sql`DELETE FROM carecore_sso_requests WHERE expires_at <= NOW()`;
  await sql`
    INSERT INTO carecore_sso_requests (state_hash, organization_id, code_verifier, nonce, next_path, expires_at)
    VALUES (${stateHash(state)}, ${organizationId}, ${codeVerifier}, ${nonce}, ${safeNext(next)},
      NOW() + make_interval(mins => ${REQUEST_MINUTES}))`;
  return oidc.buildAuthorizationUrl(config, {
    redirect_uri: ssoRedirectUri(origin),
    scope: "openid profile email",
    code_challenge: await oidc.calculatePKCECodeChallenge(codeVerifier),
    code_challenge_method: "S256",
    state,
    nonce,
  });
}

export type SsoUser = { id: string; username: string; display_name: string; role: string };

// Rückkehr vom Identity-Provider: Code einlösen, ID-Token prüfen, Konto der Einrichtung finden.
export async function completeSso(
  sql: Sql,
  currentUrl: URL,
): Promise<{ ok: true; user: SsoUser; next: string | null } | { ok: false; reason: string }> {
  const state = currentUrl.searchParams.get("state");
  if (currentUrl.searchParams.get("error"))
    return { ok: false, reason: "Die Anmeldung beim Identity-Provider wurde abgebrochen." };
  if (!state) return { ok: false, reason: "Die Anmeldung ist unvollständig." };
  const pending = (await sql`
    DELETE FROM carecore_sso_requests WHERE state_hash = ${stateHash(state)} AND expires_at > NOW()
    RETURNING organization_id, code_verifier, nonce, next_path`) as Row[];
  if (!pending[0]) return { ok: false, reason: "Die Anmeldung ist abgelaufen. Bitte erneut versuchen." };
  const organizationId = String(pending[0].organization_id);
  const row = await enabledSettings(sql, organizationId);
  if (!row) return { ok: false, reason: "SSO ist für diese Einrichtung nicht eingeschaltet." };
  let claims: Record<string, unknown> | undefined;
  try {
    const config = await configuration(row);
    const tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: String(pending[0].code_verifier),
      expectedState: state,
      expectedNonce: String(pending[0].nonce),
      idTokenExpected: true,
    });
    claims = tokens.claims();
  } catch (cause) {
    console.error("SSO callback failed", (cause as Error).message);
    return { ok: false, reason: "Die Antwort des Identity-Providers konnte nicht bestätigt werden." };
  }
  const claim = String(row.username_claim);
  const value = claims?.[claim];
  if (typeof value !== "string" || !value.trim())
    return { ok: false, reason: "Der Identity-Provider hat keinen Benutzernamen übermittelt." };
  const users = (await sql`
    SELECT u.id, u.username, u.display_name, u.role FROM carecore_users u
    JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE p.organization_id = ${organizationId} AND LOWER(u.username) = LOWER(${value.trim()})
      AND u.active AND u.archived_at IS NULL`) as Row[];
  if (users.length !== 1)
    return {
      ok: false,
      reason: "Für dieses Konto gibt es in CareOS keinen aktiven Zugang. Bitte die Administration fragen.",
    };
  const user = users[0];
  await sql`
    INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, entity_type, entity_id, action, after_data)
    VALUES (${randomUUID()}, ${organizationId}, ${user.id}, 'user', ${user.id}, 'sso_login',
      ${JSON.stringify({ issuer: String(row.issuer), claim })}::jsonb)`;
  return {
    ok: true,
    user: {
      id: String(user.id),
      username: String(user.username),
      display_name: String(user.display_name),
      role: String(user.role),
    },
    next: pending[0].next_path ? String(pending[0].next_path) : null,
  };
}
