import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import {
  completeChallenge,
  confirmEnrollment,
  createChallenge,
  disableMfa,
  isMfaEnabled,
  mfaStatus,
  regenerateRecoveryCodes,
  resetMfa,
  startEnrollment,
} from "@/lib/mfa";
import { totpCode, totpStep } from "@/lib/mfa-core";
import { carecoreDb, type CarecoreActor } from "@/lib/server-data";
import { fixture, q } from "../support/db";

const TEST_KEY = Buffer.alloc(32, 3).toString("base64");
const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

async function withKey<T>(run: () => Promise<T>) {
  const previous = process.env.CARECORE_MFA_KEY;
  process.env.CARECORE_MFA_KEY = TEST_KEY;
  try {
    return await run();
  } finally {
    if (previous === undefined) delete process.env.CARECORE_MFA_KEY;
    else process.env.CARECORE_MFA_KEY = previous;
  }
}

test("Zwei-Faktor: ohne Schlüssel nicht verfügbar", async () => {
  const f = await fixture();
  const anna = (await f.ctx("anna")).actor as unknown as CarecoreActor;
  const previous = process.env.CARECORE_MFA_KEY;
  delete process.env.CARECORE_MFA_KEY;
  try {
    assert.equal((await mfaStatus(carecoreDb(), anna.id)).available, false);
    assert.equal(await status(startEnrollment(carecoreDb(), anna)), 503);
  } finally {
    if (previous !== undefined) process.env.CARECORE_MFA_KEY = previous;
  }
});

test("Zwei-Faktor: einrichten, anmelden mit Code und Wiederherstellungscode, ausschalten, zurücksetzen", () =>
  withKey(async () => {
    const f = await fixture();
    const sql = carecoreDb();
    const anna = (await f.ctx("anna")).actor as unknown as CarecoreActor;
    const lead = (await f.ctx("leadA")).actor as unknown as CarecoreActor;

    const { secret, qr, uri } = await startEnrollment(sql, anna);
    const plain = secret.replace(/\s/g, "");
    assert.match(qr, /^data:image\/svg\+xml;base64,/);
    assert.ok(uri.includes(`secret=${plain}`));
    const [stored] = await q<{ secret_encrypted: string }>(
      "SELECT secret_encrypted FROM carecore_user_mfa WHERE user_id = $1",
      [anna.id],
    );
    assert.ok(!stored.secret_encrypted.includes(plain), "Geheimnis liegt verschlüsselt");
    assert.equal(await isMfaEnabled(sql, anna.id), false, "erst nach Bestätigung aktiv");

    assert.equal(await status(confirmEnrollment(sql, anna, "000000")), 400);
    const step = totpStep();
    const { recoveryCodes } = await confirmEnrollment(sql, anna, totpCode(plain, step));
    assert.equal(recoveryCodes.length, 10);
    assert.deepEqual(await mfaStatus(sql, anna.id), {
      available: true,
      enabled: true,
      pending: false,
      recoveryRemaining: 10,
    });
    assert.equal(await status(startEnrollment(sql, anna)), 409);

    // Anmeldung: falscher Code, dann derselbe Code wie beim Bestätigen (verbraucht), dann der nächste gültige.
    const challenge = await createChallenge(sql, anna.id, "Test-Browser");
    assert.deepEqual(await completeChallenge(sql, challenge, "123456"), {
      ok: false,
      expired: false,
      userId: anna.id,
    });
    assert.equal((await completeChallenge(sql, challenge, totpCode(plain, step))).ok, false, "kein zweites Mal");
    const next = await completeChallenge(sql, challenge, totpCode(plain, step + 1));
    assert.equal(next.ok, true);
    assert.equal(next.ok && next.kind, "totp");
    assert.equal((await completeChallenge(sql, challenge, totpCode(plain, step + 1))).ok, false, "Anfrage verbraucht");

    // Wiederherstellungscode: einmal gültig.
    const second = await createChallenge(sql, anna.id, null);
    const recovered = await completeChallenge(sql, second, recoveryCodes[0].toLowerCase());
    assert.equal(recovered.ok && recovered.kind, "recovery");
    const third = await createChallenge(sql, anna.id, null);
    assert.equal((await completeChallenge(sql, third, recoveryCodes[0])).ok, false);
    assert.equal((await mfaStatus(sql, anna.id)).recoveryRemaining, 9);

    // Fehlversuche je Anfrage begrenzt.
    const fourth = await createChallenge(sql, anna.id, null);
    for (let i = 0; i < 5; i += 1) await completeChallenge(sql, fourth, "999999");
    assert.deepEqual(await completeChallenge(sql, fourth, recoveryCodes[1]), { ok: false, expired: true });

    // Neue Codes und Ausschalten nur mit gültigem Code.
    assert.equal(await status(regenerateRecoveryCodes(sql, anna, "nope")), 400);
    const renewed = await regenerateRecoveryCodes(sql, anna, recoveryCodes[2]);
    assert.equal((await mfaStatus(sql, anna.id)).recoveryRemaining, 10);
    assert.equal(await status(disableMfa(sql, anna, recoveryCodes[3])), 400, "alte Codes gelten nicht mehr");
    await disableMfa(sql, anna, renewed.recoveryCodes[0]);
    assert.equal(await isMfaEnabled(sql, anna.id), false);

    // Administration setzt zurück (nur in der eigenen Organisation).
    const again = await startEnrollment(sql, anna);
    await confirmEnrollment(sql, anna, totpCode(again.secret.replace(/\s/g, ""), totpStep()));
    const other = (await (await fixture()).ctx("leadA")).actor as unknown as CarecoreActor;
    assert.equal(await status(resetMfa(sql, other, anna.id)), 404);
    await resetMfa(sql, lead, anna.id);
    assert.equal(await isMfaEnabled(sql, anna.id), false);
    const log = await q<{ action: string }>(
      "SELECT action FROM carecore_audit_log WHERE entity_type = 'user_mfa' AND entity_id = $1 ORDER BY created_at",
      [anna.id],
    );
    assert.deepEqual(
      log.map((row) => row.action),
      ["enabled", "recovery_regenerated", "disabled", "enabled", "reset"],
    );
  }));
