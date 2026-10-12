import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import { createManagedUser, endManagedUserSessions } from "@/lib/admin-users";
import { createSession } from "@/lib/auth";
import { saveSetting } from "@/lib/settings";
import { apiContextFor, fixture, q } from "../support/db";

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

async function admin(f: Awaited<ReturnType<typeof fixture>>) {
  const lead = await apiContextFor(f, "leadA");
  return { ...lead, actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] } };
}

const access = async (userId: string) =>
  (
    await q<{ permissions: string[]; missing: boolean }>(
      `SELECT carecore_access_permissions($1) AS permissions, COALESCE(carecore_strong_login_missing($1), FALSE) AS missing`,
      [userId],
    )
  )[0];

test("Zwei-Faktor-Pflicht: Leitungsrechte erst mit Zwei-Faktor, nur von gesichertem Konto einschaltbar", async () => {
  const f = await fixture();
  const ctx = await admin(f);
  const leader = f.people.leadA;

  // Ohne Pflicht: volle Rechte.
  let state = await access(leader);
  assert.equal(state.missing, false);
  assert.ok(state.permissions.includes("team.manage"));

  // Einschalten verlangt, dass das eigene Konto gesichert ist.
  assert.equal(await status(saveSetting(ctx, "strongLoginRequired", { enabled: true })), 400);
  await q(`INSERT INTO carecore_user_mfa (user_id, secret_encrypted, confirmed_at) VALUES ($1, 'x', NOW())`, [leader]);
  await saveSetting(ctx, "strongLoginRequired", { enabled: true });
  assert.equal((await access(leader)).missing, false, "gesichert: Rechte bleiben");

  // Leitung B ohne Zwei-Faktor verliert die Leitungsrechte, behält die Pflege-Rechte.
  state = await access(f.people.leadB);
  assert.equal(state.missing, true);
  for (const permission of ["team.manage", "schedule.manage", "quality.manage", "insights.read"])
    assert.ok(!state.permissions.includes(permission), permission);
  assert.ok(state.permissions.includes("residents.read"));
  // Mit Passkey wieder vollständig.
  await q(
    `INSERT INTO carecore_passkeys (id, user_id, credential_id, public_key, name) VALUES (gen_random_uuid(), $1, 'cred-b', 'key', 'Telefon')`,
    [f.people.leadB],
  );
  assert.ok((await access(f.people.leadB)).permissions.includes("team.manage"));
  // Pflege ist nicht betroffen.
  assert.equal((await access(f.people.anna)).missing, false);
});

test("Passwort-Richtlinie beim Anlegen: Mindestlänge der Einrichtung, verbreitete Passwörter, eigener Name", async () => {
  const f = await fixture();
  const ctx = await admin(f);
  const base = { displayName: "Petra Probe", username: "petra.probe", role: "pflege" };
  const create = (password: string) =>
    createManagedUser(ctx.actor, { ...base, username: `${base.username}.${password.length}`, password });
  assert.equal(await status(create("1234567890")), 400, "verbreitet");
  assert.equal(await status(create("Petra-sagt-hallo-2026")), 400, "eigener Name");
  await saveSetting(ctx, "passwordMinLength", { enabled: true, value: 16 });
  assert.equal(await status(create("Kurz-aber-gut-1")), 400, "kürzer als 16");
  assert.equal(await status(create("Lang-genug-und-gut-2026")), 200);
  // Zufällig erzeugte Passwörter (Einladung, Datenübernahme) sind ausgenommen.
  assert.equal(
    await status(
      createManagedUser(ctx.actor, {
        ...base,
        username: "petra.gen",
        password: "abcdefghij12",
        generatedPassword: true,
      }),
    ),
    200,
  );
});

test("Sitzungen beenden: Administration beendet alle Sitzungen einer Person, protokolliert", async () => {
  const f = await fixture();
  const ctx = await admin(f);
  await createSession(f.people.anna, "Telefon");
  await createSession(f.people.anna, "Laptop");
  assert.deepEqual(await endManagedUserSessions(ctx.actor, f.people.anna), { ended: 2 });
  const [left] = await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM carecore_sessions WHERE user_id = $1`, [
    f.people.anna,
  ]);
  assert.equal(left.n, 0);
  const [audit] = await q<{ after_data: { sessions: number } }>(
    `SELECT after_data FROM carecore_audit_log WHERE entity_id = $1 AND action = 'sessions_ended'`,
    [f.people.anna],
  );
  assert.equal(audit.after_data.sessions, 2);
  await assert.rejects(endManagedUserSessions(ctx.actor, f.people.leadA), /CANNOT_END_OWN_SESSIONS/);
});
