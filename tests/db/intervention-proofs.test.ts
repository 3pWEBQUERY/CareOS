import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { addIntervention, updateIntervention } from "@/lib/care-plan-goals";
import { residentPlan } from "@/lib/care-planning";
import { cancelProof, confirmProofs, proofView } from "@/lib/intervention-proofs";
import { apiContextFor, createResident, fixture, q } from "../support/db";

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error;
  }
  assert.fail("Fehler erwartet");
}

test("Durchführungsnachweis: Tageszeiten aus der Pflegeplanung, alles wie geplant, Abweichungen mit Grund, Storno", async () => {
  const f = await fixture();
  const reader = await apiContextFor(f, "anna");
  const nurse = {
    ...reader,
    actor: { ...reader.actor, permissions: [...reader.actor.permissions, "documentation.write"] },
  } as ApiContext;
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");
  const [{ yesterday, tomorrow }] = await q<{ yesterday: string; tomorrow: string }>(
    `SELECT to_char(NOW() AT TIME ZONE timezone - INTERVAL '1 day', 'YYYY-MM-DD') AS yesterday,
       to_char(NOW() AT TIME ZONE timezone + INTERVAL '1 day', 'YYYY-MM-DD') AS tomorrow
     FROM carecore_organizations WHERE id = $1`,
    [f.org],
  );

  // Pflegeplanung: zwei Massnahmen am Morgen (eine davon auch abends), eine ohne Tageszeit.
  const plan = randomUUID();
  const goal = randomUUID();
  await q(`INSERT INTO carecore_care_plans (id, resident_id, status) VALUES ($1, $2, 'active')`, [plan, erna]);
  await q(
    `INSERT INTO carecore_care_goals (id, care_plan_id, statement, category) VALUES ($1, $2, 'Geht sicher 25 m', 'Mobilität')`,
    [goal, plan],
  );
  const walk = await addIntervention(nurse, goal, {
    title: "Gehtraining mit Rollator",
    frequency: "2× täglich",
    dayParts: ["evening", "morning", "mittags"],
  });
  const hygiene = await addIntervention(nurse, goal, {
    title: "Ganzkörperpflege am Lavabo",
    frequency: "täglich",
    dayParts: ["morning"],
  });
  await addIntervention(nurse, goal, { title: "Fusspflege", frequency: "monatlich" });
  const planned = (await residentPlan(nurse, erna)).plan?.goals[0].interventions ?? [];
  assert.deepEqual(
    planned.map((item) => [item.title, item.dayParts]),
    [
      ["Gehtraining mit Rollator", ["morning", "evening"]],
      ["Ganzkörperpflege am Lavabo", ["morning"]],
      ["Fusspflege", []],
    ],
    "nur bekannte Tageszeiten, in fester Reihenfolge",
  );

  // Ansicht: nur Personen mit Massnahmen dieser Tageszeit.
  let view = await proofView(nurse, { careUnitId: f.units.a, date: yesterday, dayPart: "morning" });
  assert.equal(view.canWrite, true);
  assert.equal((await proofView(reader, { careUnitId: null, date: yesterday, dayPart: "morning" })).canWrite, false);
  assert.deepEqual(
    view.residents.map((resident) => [resident.name, resident.interventions.map((item) => item.title)]),
    [["Erna Muster", ["Gehtraining mit Rollator", "Ganzkörperpflege am Lavabo"]]],
  );
  view = await proofView(nurse, { careUnitId: null, date: yesterday, dayPart: "evening" });
  assert.deepEqual(
    view.residents.flatMap((resident) => resident.interventions.map((item) => item.title)),
    ["Gehtraining mit Rollator"],
  );

  // Bestätigen: Rechte, Zeitpunkt, Abweichung nur mit Grund und nur für offene Massnahmen.
  const slot = { residentId: erna, date: yesterday, dayPart: "morning" };
  assert.equal((await failure(confirmProofs(reader, { ...slot, deviations: [] }))).status, 403);
  assert.equal(
    (await failure(confirmProofs(nurse, { ...slot, date: tomorrow }))).message,
    "Diese Tageszeit hat noch nicht begonnen.",
  );
  assert.equal(
    (await failure(confirmProofs(nurse, { ...slot, residentId: otto }))).message,
    "Für diese Tageszeit sind keine Massnahmen geplant.",
  );
  assert.equal(
    (await failure(confirmProofs(nurse, { ...slot, deviations: [{ interventionId: walk, outcome: "not_done" }] })))
      .message,
    "Bitte den Grund angeben, warum die Massnahme nicht durchgeführt wurde.",
  );
  assert.equal(
    (
      await failure(
        confirmProofs(nurse, { ...slot, deviations: [{ interventionId: walk, outcome: "vergessen", reason: "x" }] }),
      )
    ).message,
    "Bitte die Abweichung wählen.",
  );
  assert.equal(
    (
      await failure(
        confirmProofs(nurse, {
          ...slot,
          deviations: [{ interventionId: randomUUID(), outcome: "partial", reason: "nur Flur" }],
        }),
      )
    ).status,
    409,
  );
  assert.deepEqual(
    await confirmProofs(nurse, {
      ...slot,
      deviations: [{ interventionId: walk, outcome: "not_done", reason: "Starke Schmerzen im Knie, Arzt informiert" }],
    }),
    { done: 1, deviations: 1 },
  );
  assert.equal(
    (await failure(confirmProofs(nurse, { ...slot, deviations: [] }))).message,
    "Alle Massnahmen dieser Tageszeit sind bereits nachgewiesen.",
  );

  // Abweichung als wichtiger Eintrag in der Pflegedokumentation.
  const entries = await q<{ title: string; body: string; importance: string }>(
    `SELECT title, body, importance FROM carecore_documentation_entries WHERE resident_id = $1`,
    [erna],
  );
  const day = yesterday.split("-").reverse().join(".");
  assert.deepEqual(entries, [
    {
      title: "Gehtraining mit Rollator",
      body: `Massnahme nicht durchgeführt (Morgen, ${day}): Starke Schmerzen im Knie, Arzt informiert`,
      importance: "important",
    },
  ]);
  view = await proofView(nurse, { careUnitId: null, date: yesterday, dayPart: "morning" });
  const proofs = view.residents[0].interventions.map((item) => [item.title, item.proof?.outcome, item.proof?.reason]);
  assert.deepEqual(proofs, [
    ["Gehtraining mit Rollator", "not_done", "Starke Schmerzen im Knie, Arzt informiert"],
    ["Ganzkörperpflege am Lavabo", "done", ""],
  ]);
  // Der Abend ist davon unberührt.
  assert.equal(
    (await proofView(nurse, { careUnitId: null, date: yesterday, dayPart: "evening" })).residents[0].interventions[0]
      .proof,
    null,
  );

  // Storno mit Grund; danach lässt sich die Massnahme neu nachweisen.
  const done = view.residents[0].interventions[1].proof!.id;
  assert.equal((await failure(cancelProof(nurse, done, { reason: " " }))).message, "Bitte einen Grund angeben.");
  assert.equal((await failure(cancelProof(reader, done, { reason: "falsche Person" }))).status, 403);
  await cancelProof(nurse, done, { reason: "falsche Person" });
  assert.equal((await failure(cancelProof(nurse, done, { reason: "falsche Person" }))).status, 409);
  assert.deepEqual(await confirmProofs(nurse, { ...slot, deviations: [] }), { done: 1, deviations: 0 });

  // Pausierte Massnahmen erscheinen nicht mehr.
  await updateIntervention(nurse, hygiene, { status: "paused" });
  view = await proofView(nurse, { careUnitId: null, date: yesterday, dayPart: "morning" });
  assert.deepEqual(
    view.residents[0].interventions.map((item) => item.title),
    ["Gehtraining mit Rollator"],
  );

  // Protokoll der Akte.
  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'intervention_proof' AND after_data->>'residentId' = $1
     ORDER BY created_at, action`,
    [erna],
  );
  assert.deepEqual(audit.map((row) => row.action).sort(), ["cancelled", "created", "created", "deviation"]);
});
