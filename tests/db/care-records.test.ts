import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { careRecordDetail, careRecordsOverview } from "@/lib/care-records";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

async function plan(resident: string, owner: string | null, values: { status?: string; review?: string } = {}) {
  const id = randomUUID();
  await q(
    `INSERT INTO carecore_care_plans (id, resident_id, owner_user_id, status, care_level, focus, review_on)
     VALUES ($1, $2, $3, $4, 'Stufe 6', 'Mobilität erhalten', $5)`,
    [id, resident, owner, values.status ?? "active", values.review ?? null],
  );
  return id;
}
async function goal(planId: string, target: string, goalStatus = "active") {
  const id = randomUUID();
  await q(
    `INSERT INTO carecore_care_goals (id, care_plan_id, category, statement, target_date, status)
     VALUES ($1, $2, 'Mobilität', 'Geht mit Rollator zum Speisesaal', $3, $4)`,
    [id, planId, target, goalStatus],
  );
  return id;
}
async function flag(resident: string, severity: string, label: string, active = true) {
  await q(
    `INSERT INTO carecore_resident_clinical_flags (id, resident_id, category, label, severity, active)
     VALUES ($1, $2, 'Risiko', $3, $4, $5)`,
    [randomUUID(), resident, label, severity, active],
  );
}

test("Pflegeakte: Übersicht mit Stand der Planung, fälligen Zielen, Massnahmen und Risiken", async () => {
  const f = await fixture();
  const anna = await apiContextFor(f, "anna");
  const erna = await createResident(f, "Erna Ohneplan");
  const hans = await createResident(f, "Hans Entwurf");
  const rosa = await createResident(f, "Rosa Faellig");
  const otto = await createResident(f, "Otto Aktuell");
  const left = await createResident(f, "Lisa Ausgetreten");
  await q(`UPDATE carecore_residents SET status = 'discharged' WHERE id = $1`, [left]);

  await plan(hans, null, { status: "draft" });
  const rosaPlan = await plan(rosa, f.people.lea);
  const due = await goal(rosaPlan, "2020-01-01");
  await goal(rosaPlan, "2099-01-01", "achieved");
  await q(
    `INSERT INTO carecore_interventions (id, care_goal_id, title, frequency) VALUES ($1, $2, 'Gehtraining', 'täglich'),
       ($3, $2, 'Alte Massnahme', 'täglich')`,
    [randomUUID(), due, randomUUID()],
  );
  await q(
    `UPDATE carecore_interventions SET status = 'completed' WHERE title = 'Alte Massnahme' AND care_goal_id = $1`,
    [due],
  );
  const ottoPlan = await plan(otto, f.people.max, { review: "2099-12-31" });
  await goal(ottoPlan, "2099-01-01");
  await flag(otto, "critical", "Sturzrisiko");
  await flag(otto, "attention", "Schluckstörung");
  await flag(otto, "info", "Brille");
  await flag(otto, "critical", "Erledigt", false);

  // Eine andere Einrichtung bleibt unsichtbar.
  const other = await fixture();
  await createResident(other, "Fremd Person");

  const rows = await careRecordsOverview(anna);
  const byName = new Map(rows.map((row) => [row.name, row]));
  assert.deepEqual(
    rows.map((row) => row.name),
    ["Otto Aktuell", "Hans Entwurf", "Rosa Faellig", "Erna Ohneplan"],
  );
  assert.equal(byName.get("Erna Ohneplan")?.status, "Ohne Planung");
  assert.equal(byName.get("Erna Ohneplan")?.planId, null);
  assert.equal(byName.get("Hans Entwurf")?.status, "Entwurf");
  const rosaRow = byName.get("Rosa Faellig")!;
  assert.equal(rosaRow.status, "Evaluation fällig");
  assert.deepEqual([rosaRow.activeGoals, rosaRow.goalsDue, rosaRow.activeInterventions], [1, 1, 1]);
  assert.equal(rosaRow.ownerName, "Lea Beispiel");
  assert.equal(rosaRow.careUnit, "Wohngruppe A");
  const ottoRow = byName.get("Otto Aktuell")!;
  assert.equal(ottoRow.status, "Aktuell");
  assert.equal(ottoRow.reviewOn, "2099-12-31");
  // Nur aktive Hinweise „Beachten“ und „Kritisch“ zählen als Risiko.
  assert.equal(ottoRow.risks, 2);
  assert.equal(ottoRow.initials, "OA");

  // Überprüfung fällig (Datum erreicht) ohne fällige Ziele.
  await q(`UPDATE carecore_care_plans SET review_on = '2020-01-01' WHERE id = $1`, [ottoPlan]);
  assert.equal((await careRecordsOverview(anna)).find((row) => row.id === otto)?.status, "Evaluation fällig");
  assert.equal(erna.length, 36);
});

test("Pflegeakte: Detail mit Plan, Hinweisen nach Schwere und beteiligten Personen ohne Doppelte", async () => {
  const f = await fixture();
  const anna = await apiContextFor(f, "anna");
  const otto = await createResident(f, "Otto Detail");
  const ottoPlan = await plan(otto, f.people.max);
  await goal(ottoPlan, "2099-01-01");
  await q(`UPDATE carecore_residents SET primary_care_user_id = $1 WHERE id = $2`, [f.people.max, otto]);
  await q(
    `INSERT INTO carecore_resident_contacts (id, resident_id, full_name, relationship, is_primary, is_emergency_contact)
     VALUES ($1, $3, 'Paula Detail', 'Tochter', TRUE, TRUE), ($2, $3, 'Kurt Nachbar', '', FALSE, FALSE)`,
    [randomUUID(), randomUUID(), otto],
  );
  await flag(otto, "info", "Hörgerät");
  await flag(otto, "critical", "Sturzrisiko");
  await flag(otto, "attention", "Diabetes");
  await flag(otto, "critical", "Aufgehoben", false);

  const detail = await careRecordDetail(anna, otto);
  assert.equal(detail.plan?.goals.length, 1);
  assert.deepEqual(
    detail.flags.map((item) => item.label),
    ["Sturzrisiko", "Diabetes", "Hörgerät"],
  );
  // Bezugspflege und Hauptverantwortliche sind dieselbe Person: nur einmal (mit der ersten Rolle).
  assert.deepEqual(detail.team, [
    { name: "Max Meier", role: "Bezugspflege" },
    { name: "Paula Detail", role: "Tochter · Notfallkontakt" },
    { name: "Kurt Nachbar", role: "Kontaktperson" },
  ]);

  // Fremde Einrichtung und ungültige Kennung.
  const other = await fixture();
  const foreign = await createResident(other, "Fremd Person");
  assert.equal(await status(careRecordDetail(anna, foreign)), 404);
  assert.equal(await status(careRecordDetail(anna, "keine-kennung")), 400);
});
