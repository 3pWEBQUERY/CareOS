import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import {
  finishLogin,
  finishRegistration,
  listPasskeys,
  removePasskey,
  startLogin,
  startRegistration,
  type RelyingParty,
} from "@/lib/passkeys";
import type { CarecoreActor } from "@/lib/server-data";
import { fixture, q } from "../support/db";
import { assertCredential, createCredential } from "../support/webauthn";

const rp: RelyingParty = { rpID: "carecore.test", origin: "https://carecore.test" };

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: "" }),
    (error) => ({
      status: error instanceof ApiError ? error.status : 500,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

async function actorOf(f: Awaited<ReturnType<typeof fixture>>, person: string) {
  const ctx = await f.ctx(person);
  return { sql: ctx.sql, actor: ctx.actor as unknown as CarecoreActor };
}

async function register(f: Awaited<ReturnType<typeof fixture>>, person: string, name = "Diensthandy") {
  const { sql, actor } = await actorOf(f, person);
  const start = await startRegistration(sql, actor, rp);
  const { credential, response } = createCredential({ ...rp, challenge: start.options.challenge });
  const saved = await finishRegistration(sql, actor, rp, { token: start.token, response, name });
  return { sql, actor, credential, saved };
}

test("Passkeys: registrieren nur mit Bestätigung am Gerät, einmalige Herausforderung, protokolliert", async () => {
  const f = await fixture();
  const { sql, actor } = await actorOf(f, "anna");

  // Ohne Bestätigung (UV) wird nichts gespeichert.
  const noUv = await startRegistration(sql, actor, rp);
  const weak = createCredential({ ...rp, challenge: noUv.options.challenge }, false);
  assert.equal(
    (await failure(finishRegistration(sql, actor, rp, { token: noUv.token, response: weak.response }))).status,
    400,
  );

  // Falsche Domain wird abgelehnt.
  const other = await startRegistration(sql, actor, rp);
  const foreign = createCredential({
    rpID: "evil.test",
    origin: "https://evil.test",
    challenge: other.options.challenge,
  });
  assert.equal(
    (await failure(finishRegistration(sql, actor, rp, { token: other.token, response: foreign.response }))).status,
    400,
  );

  const start = await startRegistration(sql, actor, rp);
  const { response } = createCredential({ ...rp, challenge: start.options.challenge });
  const saved = await finishRegistration(sql, actor, rp, { token: start.token, response, name: "Diensthandy" });
  // Dieselbe Herausforderung ein zweites Mal: abgelaufen.
  assert.equal(
    (await failure(finishRegistration(sql, actor, rp, { token: start.token, response, name: "Nochmals" }))).status,
    409,
  );

  const [listed] = await listPasskeys(sql, actor.id);
  assert.equal(listed.name, "Diensthandy");
  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'user_passkey' AND entity_id = $1`,
    [saved.id],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["registered"],
  );
  // Beim nächsten Einrichten wird der vorhandene Passkey ausgeschlossen (kein Doppel auf demselben Gerät).
  const again = await startRegistration(sql, actor, rp);
  assert.equal(again.options.excludeCredentials?.length, 1);
});

test("Passkeys: Anmeldung mit Signatur, Zähler steigt, fremde Domain, fehlende Bestätigung und Wiederholung abgelehnt", async () => {
  const f = await fixture();
  const { sql, actor, credential } = await register(f, "anna");

  const login = await startLogin(sql, rp);
  assert.equal(login.options.userVerification, "required");
  const response = assertCredential(credential, { ...rp, challenge: login.options.challenge });
  const result = await finishLogin(sql, rp, { token: login.token, response });
  assert.ok(result.ok);
  assert.equal(result.user.id, actor.id);
  const stored = await q<{ counter: string; last_used_at: Date | null }>(
    `SELECT counter, last_used_at FROM carecore_passkeys WHERE user_id = $1`,
    [actor.id],
  );
  assert.equal(Number(stored[0].counter), 1);
  assert.ok(stored[0].last_used_at);

  // Dieselbe Antwort erneut (Wiederholung): Herausforderung ist verbraucht.
  const replay = await finishLogin(sql, rp, { token: login.token, response });
  assert.deepEqual(replay, { ok: false, expired: true });

  // Ohne Bestätigung am Gerät
  const noUv = await startLogin(sql, rp);
  const weak = assertCredential(credential, { ...rp, challenge: noUv.options.challenge }, false);
  assert.equal((await finishLogin(sql, rp, { token: noUv.token, response: weak })).ok, false);

  // Antwort für eine andere Domain
  const phishing = await startLogin(sql, rp);
  const foreign = assertCredential(credential, {
    rpID: "evil.test",
    origin: "https://evil.test",
    challenge: phishing.options.challenge,
  });
  assert.equal((await finishLogin(sql, rp, { token: phishing.token, response: foreign })).ok, false);

  // Signatur zu einer anderen Herausforderung
  const first = await startLogin(sql, rp);
  const second = await startLogin(sql, rp);
  const mismatched = assertCredential(credential, { ...rp, challenge: second.options.challenge });
  assert.equal((await finishLogin(sql, rp, { token: first.token, response: mismatched })).ok, false);
});

test("Passkeys: entfernt oder Konto deaktiviert – keine Anmeldung mehr; nur eigene Passkeys entfernbar", async () => {
  const f = await fixture();
  const { sql, actor, credential, saved } = await register(f, "anna");
  const other = await actorOf(f, "leadA");
  assert.equal((await failure(removePasskey(other.sql, other.actor, saved.id))).status, 404);

  await q(`UPDATE carecore_users SET active = FALSE WHERE id = $1`, [actor.id]);
  const inactive = await startLogin(sql, rp);
  assert.equal(
    (
      await finishLogin(sql, rp, {
        token: inactive.token,
        response: assertCredential(credential, { ...rp, challenge: inactive.options.challenge }),
      })
    ).ok,
    false,
  );
  await q(`UPDATE carecore_users SET active = TRUE WHERE id = $1`, [actor.id]);

  await removePasskey(sql, actor, saved.id);
  assert.equal((await listPasskeys(sql, actor.id)).length, 0);
  const removed = await startLogin(sql, rp);
  assert.equal(
    (
      await finishLogin(sql, rp, {
        token: removed.token,
        response: assertCredential(credential, { ...rp, challenge: removed.options.challenge }),
      })
    ).ok,
    false,
  );
});
