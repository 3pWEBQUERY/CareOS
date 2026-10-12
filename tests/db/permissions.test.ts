import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { updateManagedUser } from "@/lib/admin-users";
import { saveQualification } from "@/lib/roster/settings-service";
import { fixture, q, qualify, type Fixture } from "../support/db";

// Wirksame Berechtigungen, wie sie Anmeldung, Navigation und Zweitunterschrift verwenden.
const canMedicate = async (f: Fixture, person: string) => {
  const [row] = await q<{ permissions: string[] | null }>(`SELECT carecore_effective_permissions($1) AS permissions`, [
    f.people[person],
  ]);
  return (row.permissions ?? []).includes("medication.manage");
};

const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("Medikation: Leitung immer, Pflege nur mit gültiger HF- oder FaGe-Qualifikation", async () => {
  const f = await fixture();
  assert.equal(await canMedicate(f, "leadA"), true, "Leitung darf Medikation");
  assert.equal(await canMedicate(f, "anna"), false, "Pflege ohne Qualifikation nicht");

  await qualify(f, "anna", "FAGE");
  assert.equal(await canMedicate(f, "anna"), true, "Fachperson Gesundheit");
  await qualify(f, "max", "HF");
  assert.equal(await canMedicate(f, "max"), true, "Pflegefachperson HF");
  await qualify(f, "lea", "SRK");
  assert.equal(await canMedicate(f, "lea"), false, "Pflegehelfer:in SRK nicht");

  // Abgelaufene oder noch nicht gültige Qualifikationen zählen nicht.
  await qualify(f, "ben", "HF", "2000-01-01", isoDay(-2));
  assert.equal(await canMedicate(f, "ben"), false, "abgelaufen");
  await qualify(f, "sam", "FAGE", isoDay(3));
  assert.equal(await canMedicate(f, "sam"), false, "erst ab übermorgen gültig");

  // Qualifikationen einer anderen Organisation zählen nicht.
  const other = await fixture();
  await q(
    `INSERT INTO carecore_employee_qualifications (user_id, qualification_id, valid_from)
     SELECT $1, id, '2000-01-01' FROM carecore_qualifications WHERE organization_id = $2 AND code = 'HF'`,
    [f.people.lea, other.org],
  );
  assert.equal(await canMedicate(f, "lea"), false, "fremde Organisation");
});

test("Medikationsrecht einer Qualifikation wird in den Einstellungen gesetzt und protokolliert", async () => {
  const f = await fixture();
  const lead = await f.ctx("leadA");
  await saveQualification(lead, { code: "fh", name: "Pflegefachperson FH", grantsMedication: true });
  await qualify(f, "anna", "FH");
  assert.equal(await canMedicate(f, "anna"), true);

  // Ohne Häkchen gespeichert: Recht entfällt; vorher/nachher steht im Protokoll.
  await saveQualification(lead, { code: "FH", name: "Pflegefachperson FH" });
  assert.equal(await canMedicate(f, "anna"), false);
  const audit = await q<{ before_data: { grantsMedication: boolean }; after_data: { grantsMedication: boolean } }>(
    `SELECT before_data, after_data FROM carecore_roster_audit
     WHERE organization_id = $1 AND entity_type = 'qualification' ORDER BY created_at DESC LIMIT 1`,
    [f.org],
  );
  assert.deepEqual([audit[0].before_data.grantsMedication, audit[0].after_data.grantsMedication], [true, false]);
  await assert.rejects(saveQualification(lead, { code: "FH", name: "FH", grantsMedication: "ja" }), /ungültig/);
  await assert.rejects(saveQualification(await f.ctx("anna"), { code: "X", name: "X", grantsMedication: true }));
});

test("Rollen ohne Qualifikationspflicht behalten die Medikation unverändert", async () => {
  const f = await fixture();
  const key = `test-${randomUUID().slice(0, 8)}`;
  await q(
    `INSERT INTO carecore_roles (id, key, name, permissions) VALUES ($1, $2, 'Test', '["medication.manage"]'::jsonb)`,
    [randomUUID(), key],
  );
  await q(`UPDATE carecore_users SET role = $2 WHERE id = $1`, [f.people.anna, key]);
  assert.equal(await canMedicate(f, "anna"), true);
  await q(`UPDATE carecore_roles SET medication_requires_qualification = TRUE WHERE key = $1`, [key]);
  assert.equal(await canMedicate(f, "anna"), false);
  const [arzt] = await q<{ permissions: string[] }>(`SELECT permissions FROM carecore_roles WHERE key = 'arzt'`);
  assert.ok(arzt.permissions.includes("medication.manage"), "Ärztlicher Dienst unverändert");
});

test("Medikationsrechte getrennt: verabreichen und verwalten, beide an die Qualifikation gebunden", async () => {
  const f = await fixture();
  const effective = async (person: string) =>
    (
      await q<{ permissions: string[] | null }>(`SELECT carecore_effective_permissions($1) AS permissions`, [
        f.people[person],
      ])
    )[0].permissions ?? [];
  // Bestehende Rollen mit Medikationsrecht erhalten beide Rechte (keine Änderung für die Einrichtung).
  for (const key of ["admin", "leitung", "pflege", "arzt"]) {
    const [role] = await q<{ permissions: string[] }>(`SELECT permissions FROM carecore_roles WHERE key = $1`, [key]);
    assert.ok(role.permissions.includes("medication.administer"), `${key}: verabreichen`);
    assert.ok(role.permissions.includes("medication.manage"), `${key}: verwalten`);
  }
  // Pflege ohne Qualifikation: keines der beiden Rechte; mit Qualifikation beide.
  assert.ok(!(await effective("anna")).some((p) => p.startsWith("medication.")));
  await qualify(f, "anna", "FAGE");
  assert.deepEqual((await effective("anna")).filter((p) => p.startsWith("medication.")).sort(), [
    "medication.administer",
    "medication.manage",
  ]);
  // Eine Rolle nur zum Verabreichen: keine Verwaltung, auch mit Qualifikationspflicht korrekt gefiltert.
  const key = `test-${randomUUID().slice(0, 8)}`;
  await q(
    `INSERT INTO carecore_roles (id, key, name, permissions, medication_requires_qualification)
     VALUES ($1, $2, 'Nur verabreichen', '["residents.read", "medication.administer"]'::jsonb, TRUE)`,
    [randomUUID(), key],
  );
  await q(`UPDATE carecore_users SET role = $2 WHERE id = $1`, [f.people.max, key]);
  assert.deepEqual(await effective("max"), ["residents.read"]);
  await qualify(f, "max", "HF");
  assert.deepEqual((await effective("max")).sort(), ["medication.administer", "residents.read"]);
});

test("Mitarbeiterverwaltung: Qualifikationen setzen und entfernen, Verlauf bleibt, Protokoll mit Organisation", async () => {
  const f = await fixture();
  const quals = await q<{ id: string; code: string }>(
    `SELECT id, code FROM carecore_qualifications WHERE organization_id = $1`,
    [f.org],
  );
  const id = (code: string) => quals.find((row) => row.code === code)!.id;
  const profile = { displayName: "Anna Müller", username: `anna-${f.org.slice(0, 6)}`, role: "pflege" };
  // Eine frühere HF-Qualifikation (seit 2020) bleibt als Verlauf erhalten, wenn sie entfernt wird.
  await qualify(f, "anna", "HF", "2020-01-01");
  const result = await updateManagedUser(f.people.leadA, f.people.anna, { ...profile, qualificationIds: [id("FAGE")] });
  assert.deepEqual(result.users.find((user) => user.id === f.people.anna)?.qualificationIds, [id("FAGE")]);
  assert.equal(await canMedicate(f, "anna"), true);
  const history = await q<{ code: string; ended: boolean }>(
    `SELECT q.code, eq.valid_until IS NOT NULL AS ended FROM carecore_employee_qualifications eq
     JOIN carecore_qualifications q ON q.id = eq.qualification_id WHERE eq.user_id = $1 ORDER BY q.code`,
    [f.people.anna],
  );
  assert.deepEqual(history, [
    { code: "FAGE", ended: false },
    { code: "HF", ended: true },
  ]);
  // Am selben Tag wieder entfernt: die Vergabe wird zurückgenommen.
  await updateManagedUser(f.people.leadA, f.people.anna, { ...profile, qualificationIds: [] });
  assert.equal(await canMedicate(f, "anna"), false);
  const other = await fixture();
  const foreign = (
    await q<{ id: string }>(`SELECT id FROM carecore_qualifications WHERE organization_id = $1 LIMIT 1`, [other.org])
  )[0].id;
  await assert.rejects(
    updateManagedUser(f.people.leadA, f.people.anna, { ...profile, qualificationIds: [foreign] }),
    /QUALIFICATION_NOT_FOUND/,
  );
  const [logged] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_audit_log WHERE entity_type = 'user' AND entity_id = $1 AND organization_id = $2`,
    [f.people.anna, f.org],
  );
  assert.equal(logged.n, 2);
});
