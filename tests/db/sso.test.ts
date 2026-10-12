import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { completeSso, readSsoSettings, saveSsoSettings, ssoProviders, startSso } from "@/lib/sso";
import { apiContextFor, fixture, q } from "../support/db";
import { MOCK_CLIENT_ID, MOCK_CLIENT_SECRET, startMockOidc } from "../support/mock-oidc.mjs";

process.env.CARECORE_MFA_KEY = randomBytes(32).toString("hex");
process.env.CARECORE_SSO_ALLOW_HTTP = "1";
const idp = await startMockOidc(0);
after(() => idp.close());

const origin = "https://carecore.test";
const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

async function setup() {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const admin = {
    ...lead,
    actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] },
  };
  const [anna] = await q<{ username: string }>(`SELECT username FROM carecore_users WHERE id = $1`, [f.people.anna]);
  return { f, admin, annaUsername: anna.username };
}

const configure = (admin: Awaited<ReturnType<typeof setup>>["admin"], enabled = true) =>
  saveSsoSettings(admin, {
    enabled,
    issuer: idp.issuer,
    clientId: MOCK_CLIENT_ID,
    clientSecret: MOCK_CLIENT_SECRET,
    usernameClaim: "preferred_username",
    buttonLabel: "Test-Anmeldung",
  });

// Wie der Browser: Adresse beim Anbieter aufrufen, Weiterleitung zurück zu CareOS abfangen.
async function roundTrip(sql: Parameters<typeof completeSso>[0], organizationId: string, next?: string) {
  const authorize = await startSso(sql, organizationId, origin, next);
  const response = await fetch(authorize, { redirect: "manual" });
  return new URL(response.headers.get("location")!);
}

test("SSO: nur Administration, https Pflicht, Secret verschlüsselt und nie zurückgegeben", async () => {
  const { f, admin } = await setup();
  const anna = await apiContextFor(f, "anna");
  assert.equal(await failure(configure(anna as typeof admin)), 403);
  process.env.CARECORE_SSO_ALLOW_HTTP = "0";
  assert.equal(await failure(configure(admin)), 400, "http nur im Test erlaubt");
  process.env.CARECORE_SSO_ALLOW_HTTP = "1";
  const saved = await configure(admin);
  assert.equal(saved.hasSecret, true);
  assert.equal(JSON.stringify(saved).includes(MOCK_CLIENT_SECRET), false);
  const [row] = await q<{ client_secret_encrypted: string }>(
    `SELECT client_secret_encrypted FROM carecore_sso_settings WHERE organization_id = $1`,
    [f.org],
  );
  assert.equal(row.client_secret_encrypted.includes(MOCK_CLIENT_SECRET), false);
  // Ohne neues Secret bleibt das bisherige.
  await saveSsoSettings(admin, { ...saved, clientSecret: "", enabled: true });
  assert.equal((await readSsoSettings(admin)).hasSecret, true);
  assert.ok((await ssoProviders(admin.sql)).some((provider) => provider.id === f.org));
});

test("SSO: Anmeldung eines bestehenden Kontos mit PKCE, state und nonce; einmal einlösbar; protokolliert", async () => {
  const { f, admin, annaUsername } = await setup();
  await configure(admin);
  idp.setUser({ preferred_username: annaUsername.toUpperCase() });
  const callback = await roundTrip(admin.sql, f.org, "/c/vitalwerte");
  assert.equal(callback.origin + callback.pathname, `${origin}/api/auth/sso/callback`);
  const result = await completeSso(admin.sql, callback);
  assert.ok(result.ok, "Gross-/Kleinschreibung des Benutzernamens spielt keine Rolle");
  assert.equal(result.user.id, f.people.anna);
  assert.equal(result.next, "/c/vitalwerte");
  const replay = await completeSso(admin.sql, callback);
  assert.equal(replay.ok, false, "derselbe Rückweg gilt nur einmal");
  const audit = await q(`SELECT 1 FROM carecore_audit_log WHERE action = 'sso_login' AND actor_user_id = $1`, [
    f.people.anna,
  ]);
  assert.equal(audit.length, 1);
  // Unsichere Rücksprungadressen werden verworfen.
  idp.setUser({ preferred_username: annaUsername });
  const external = await completeSso(admin.sql, await roundTrip(admin.sql, f.org, "https://evil.test/"));
  assert.ok(external.ok);
  assert.equal(external.next, null);
});

test("SSO: kein Zugang für unbekannte, fremde oder deaktivierte Konten, falschen state oder ausgeschaltetes SSO", async () => {
  const { f, admin, annaUsername } = await setup();
  const other = await setup();
  await configure(admin);

  idp.setUser({ preferred_username: "gibt-es-nicht" });
  assert.equal((await completeSso(admin.sql, await roundTrip(admin.sql, f.org))).ok, false);

  idp.setUser({ preferred_username: other.annaUsername });
  assert.equal(
    (await completeSso(admin.sql, await roundTrip(admin.sql, f.org))).ok,
    false,
    "Konto einer anderen Einrichtung",
  );

  await q(`UPDATE carecore_users SET active = FALSE WHERE id = $1`, [f.people.anna]);
  idp.setUser({ preferred_username: annaUsername });
  assert.equal((await completeSso(admin.sql, await roundTrip(admin.sql, f.org))).ok, false, "deaktiviert");
  await q(`UPDATE carecore_users SET active = TRUE WHERE id = $1`, [f.people.anna]);

  const tampered = await roundTrip(admin.sql, f.org);
  tampered.searchParams.set("state", "gefälscht");
  assert.equal((await completeSso(admin.sql, tampered)).ok, false);

  await configure(admin, false);
  assert.equal(await failure(startSso(admin.sql, f.org, origin, null)), 404);
  assert.equal(
    (await ssoProviders(admin.sql)).some((provider) => provider.id === f.org),
    false,
  );
});
