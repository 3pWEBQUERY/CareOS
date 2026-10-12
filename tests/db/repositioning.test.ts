import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError, type ApiContext } from "@/lib/api-context";
import {
  cancelRepositioningEntry,
  createRepositioningEntry,
  endRepositioningPlan,
  repositioningView,
  saveRepositioningPlan,
} from "@/lib/repositioning";
import { dailyWorklist } from "@/lib/worklist";
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

const items = async (ctx: ApiContext, unit: string, residentId: string) =>
  ((await dailyWorklist(ctx, unit)).residents.find((resident) => resident.id === residentId)?.items ?? [])
    .filter((item) => item.kind === "repositioning")
    .map((item) => [item.label, item.tone]);

test("Lagerung: Plan aus der Pflegeplanung, Positionswechsel, Storno, Tagesliste und Protokoll", async () => {
  const f = await fixture();
  // Die Pflege der Fixture darf lesen; Dokumentationsrecht einmal mit, einmal ohne.
  const reader = await apiContextFor(f, "anna");
  const nurse = {
    ...reader,
    actor: { ...reader.actor, permissions: [...reader.actor.permissions, "documentation.write"] },
  } as ApiContext;
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");

  // Ohne Plan: nichts in der Tagesliste, Wechsel lassen sich trotzdem erfassen.
  let view = await repositioningView(nurse, erna, null);
  assert.equal(view.plan, null);
  assert.equal(view.nextDueAt, null);
  assert.equal(view.canWrite, true);
  assert.equal((await repositioningView(reader, erna, null)).canWrite, false);
  assert.deepEqual(await items(nurse, f.units.a, erna), []);

  // Massnahme der Pflegeplanung als Grundlage.
  const plan = randomUUID();
  const goal = randomUUID();
  const intervention = randomUUID();
  await q(`INSERT INTO carecore_care_plans (id, resident_id, status) VALUES ($1, $2, 'active')`, [plan, erna]);
  await q(
    `INSERT INTO carecore_care_goals (id, care_plan_id, statement, category) VALUES ($1, $2, 'Haut intakt', 'Haut & Wunden')`,
    [goal, plan],
  );
  await q(
    `INSERT INTO carecore_interventions (id, care_goal_id, title, frequency) VALUES ($1, $2, 'Lagerung 30°', 'alle 3 Std.')`,
    [intervention, goal],
  );
  view = await repositioningView(nurse, erna, null);
  assert.deepEqual(view.interventions, [{ id: intervention, title: "Lagerung 30°", frequency: "alle 3 Std." }]);

  assert.equal((await failure(saveRepositioningPlan(reader, erna, { intervalMinutes: 180 }))).status, 403);
  for (const intervalMinutes of [0, 10, 1441, 90.5])
    assert.equal((await failure(saveRepositioningPlan(nurse, erna, { intervalMinutes }))).status, 400);
  // Massnahme einer anderen Person wird nicht angenommen.
  assert.equal(
    (await failure(saveRepositioningPlan(nurse, otto, { intervalMinutes: 180, interventionId: intervention }))).status,
    404,
  );
  await saveRepositioningPlan(nurse, erna, { intervalMinutes: 180, interventionId: intervention, note: "Keil links" });
  // Neuer Plan seit zwei Stunden ohne Wechsel: noch nicht fällig, Erinnerung erst in der letzten Stunde.
  await q(
    `UPDATE carecore_repositioning_plans SET created_at = NOW() - INTERVAL '2 hours 30 minutes' WHERE resident_id = $1`,
    [erna],
  );
  view = await repositioningView(nurse, erna, null);
  assert.equal(view.plan?.intervalMinutes, 180);
  assert.equal(view.plan?.intervention, "Lagerung 30°");
  assert.equal(view.overdue, false);
  assert.deepEqual(await items(nurse, f.units.a, erna), [["Lagerung", "info"]]);
  await q(`UPDATE carecore_repositioning_plans SET created_at = NOW() - INTERVAL '4 hours' WHERE resident_id = $1`, [
    erna,
  ]);
  assert.equal((await repositioningView(nurse, erna, null)).overdue, true);
  assert.deepEqual(await items(nurse, f.units.a, erna), [["Lagerung fällig", "attention"]]);

  // Positionswechsel: Pflichtangaben, „Andere“ nur mit Beschreibung, Zeitpunkt nicht in der Zukunft.
  assert.equal(
    (await failure(createRepositioningEntry(reader, { residentId: erna, position: "back", skin: "normal" }))).status,
    403,
  );
  assert.equal(
    (await failure(createRepositioningEntry(nurse, { residentId: erna, position: "kopfstand", skin: "normal" })))
      .message,
    "Bitte die Position wählen.",
  );
  assert.equal(
    (await failure(createRepositioningEntry(nurse, { residentId: erna, position: "other", skin: "normal" }))).message,
    "Bitte die Position in der Bemerkung beschreiben.",
  );
  assert.equal(
    (
      await failure(
        createRepositioningEntry(nurse, {
          residentId: erna,
          position: "back",
          skin: "normal",
          performedAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      )
    ).message,
    "Der Zeitpunkt liegt in der Zukunft.",
  );
  const requestId = randomUUID();
  const performedAt = new Date(Date.now() - 30 * 60_000).toISOString();
  const first = await createRepositioningEntry(
    nurse,
    { residentId: erna, position: "left30", skin: "blanching", performedAt },
    requestId,
  );
  assert.ok(first.id);
  // Dieselbe Anfrage aus der Offline-Warteschlange noch einmal: kein zweiter Eintrag.
  assert.deepEqual(
    await createRepositioningEntry(
      nurse,
      { residentId: erna, position: "left30", skin: "blanching", performedAt },
      requestId,
    ),
    { id: null },
  );
  view = await repositioningView(nurse, erna, null);
  assert.equal(view.entries.length, 1);
  assert.equal(view.overdue, false);
  assert.equal(
    Date.parse(view.nextDueAt!) - Date.parse(performedAt),
    180 * 60_000,
    "nächster Wechsel = letzter + Intervall",
  );
  assert.deepEqual(await items(nurse, f.units.a, erna), []);

  // Storno: bleibt sichtbar, zählt nicht mehr für den nächsten Wechsel.
  assert.equal((await failure(cancelRepositioningEntry(nurse, first.id, { reason: "" }))).status, 400);
  await cancelRepositioningEntry(nurse, first.id, { reason: "falsche Person" });
  assert.equal((await failure(cancelRepositioningEntry(nurse, first.id, { reason: "nochmals" }))).status, 409);
  view = await repositioningView(nurse, erna, null);
  assert.equal(view.entries[0].cancelled?.reason, "falsche Person");
  assert.equal(view.lastAt, null);
  assert.equal(view.overdue, true);

  // Plan ändern ersetzt den bisherigen, beenden mit Grund; danach keine Erinnerung mehr.
  await saveRepositioningPlan(nurse, erna, { intervalMinutes: 120 });
  const plans = await q<{ interval_minutes: number; ended: boolean; end_reason: string }>(
    `SELECT interval_minutes, ended_at IS NOT NULL AS ended, end_reason FROM carecore_repositioning_plans
     WHERE resident_id = $1 ORDER BY created_at`,
    [erna],
  );
  assert.deepEqual(plans, [
    { interval_minutes: 180, ended: true, end_reason: "Durch neuen Plan ersetzt" },
    { interval_minutes: 120, ended: false, end_reason: "" },
  ]);
  assert.equal((await failure(endRepositioningPlan(nurse, erna, { reason: "" }))).status, 400);
  await endRepositioningPlan(nurse, erna, { reason: "wieder selbständig mobil" });
  assert.equal((await failure(endRepositioningPlan(nurse, erna, { reason: "nochmals" }))).status, 404);
  assert.equal((await repositioningView(nurse, erna, null)).plan, null);
  assert.deepEqual(await items(nurse, f.units.a, erna), []);

  // Protokoll der Akte.
  const audit = await q<{ entity_type: string; action: string }>(
    `SELECT entity_type, action FROM carecore_audit_log WHERE after_data ->> 'residentId' = $1
       AND entity_type LIKE 'repositioning_%' ORDER BY created_at`,
    [erna],
  );
  assert.deepEqual(
    audit.map((row) => `${row.entity_type}:${row.action}`),
    [
      "repositioning_plan:created",
      "repositioning_entry:created",
      "repositioning_entry:cancelled",
      "repositioning_plan:updated",
      "repositioning_plan:ended",
    ],
  );

  // Andere Einrichtung: weder lesen noch schreiben.
  const other = await fixture();
  const stranger = await apiContextFor(other, "anna");
  assert.equal((await failure(repositioningView(stranger, erna, null))).status, 404);
});
