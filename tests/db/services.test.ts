import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError, type ApiContext } from "@/lib/api-context";
import type { Permission } from "@/lib/server-data";
import {
  cancelServiceRecord,
  createServiceRecord,
  listCatalog,
  saveCatalogItem,
  serviceDay,
  serviceReport,
} from "@/lib/services";
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

const withPermission = (ctx: ApiContext, permission: Permission): ApiContext => ({
  ...ctx,
  actor: { ...ctx.actor, permissions: [...ctx.actor.permissions, permission] },
});

test("Leistungen: Katalog, Vorschläge aus Aufgaben und Massnahmen, Stornierung und Monatsauswertung", async () => {
  const f = await fixture();
  // Die Rollen der Fixture haben weder Dokumentations- noch Administrationsrecht.
  const reader = await apiContextFor(f, "anna");
  const ctx = withPermission(reader, "documentation.write");
  const admin = withPermission(await apiContextFor(f, "leadA"), "administration.manage");
  const erna = await createResident(f, "Erna Muster");

  // Katalog: nur mit Administrationsrecht, Bezeichnung eindeutig, Minuten nur als Vorschlag.
  assert.equal((await failure(saveCatalogItem(ctx, null, { name: "Körperpflege", category: "Pflege" }))).status, 403);
  const { id: washing } = await saveCatalogItem(admin, null, {
    name: "Körperpflege Ganzwäsche",
    category: "Pflege",
    code: "KP-01",
    defaultMinutes: 25,
  });
  assert.equal(
    (await failure(saveCatalogItem(admin, null, { name: "körperpflege ganzwäsche", category: "Pflege" }))).status,
    409,
  );
  assert.match(
    (await failure(saveCatalogItem(admin, null, { name: "Mobilisation", category: "Pflege", defaultMinutes: 0 })))
      .message,
    /ganze Minuten/,
  );
  const { id: retired } = await saveCatalogItem(admin, null, { name: "Alte Leistung", category: "Organisation" });
  await saveCatalogItem(admin, retired, { name: "Alte Leistung", category: "Organisation", active: false });
  assert.deepEqual(
    (await listCatalog(admin)).map((item) => item.name),
    ["Körperpflege Ganzwäsche"],
  );
  assert.equal((await listCatalog(admin, true)).length, 2);

  // Vorschläge: erledigte Aufgabe von heute und laufende Massnahme der Pflegeplanung.
  const task = randomUUID();
  await q(
    `INSERT INTO carecore_tasks (id, organization_id, resident_id, title, category, status, completed_at, completed_by)
     VALUES ($1, $2, $3, 'Körperpflege Ganzwäsche', 'Pflege', 'completed', NOW() - INTERVAL '1 minute', $4)`,
    [task, f.org, erna, f.people.anna],
  );
  const plan = randomUUID();
  const goal = randomUUID();
  const intervention = randomUUID();
  await q(`INSERT INTO carecore_care_plans (id, resident_id) VALUES ($1, $2)`, [plan, erna]);
  await q(
    `INSERT INTO carecore_care_goals (id, care_plan_id, category, statement) VALUES ($1, $2, 'Mobilität', 'Geht sicher')`,
    [goal, plan],
  );
  await q(
    `INSERT INTO carecore_interventions (id, care_goal_id, title, frequency) VALUES ($1, $2, 'Gehtraining', 'täglich')`,
    [intervention, goal],
  );

  let day = await serviceDay(ctx, erna, null);
  assert.equal(day.canWrite, true);
  assert.equal((await serviceDay(reader, erna, day.day)).canWrite, false);
  assert.deepEqual(
    day.suggestions.map((item) => [item.source, item.title, item.category, item.catalogId]),
    [
      ["task", "Körperpflege Ganzwäsche", "Pflege", washing],
      ["intervention", "Gehtraining", "Pflege", null],
    ],
  );

  // Erfassen: Pflichtangaben, Rechte, keine Leistung in der Zukunft.
  assert.equal(
    (
      await failure(
        createServiceRecord(reader, { residentId: erna, title: "Gehtraining", category: "Pflege", minutes: 10 }),
      )
    ).status,
    403,
  );
  assert.match(
    (
      await failure(
        createServiceRecord(ctx, { residentId: erna, title: "Gehtraining", category: "Pflege", minutes: 0 }),
      )
    ).message,
    /ganze Minuten/,
  );
  assert.match(
    (
      await failure(
        createServiceRecord(ctx, {
          residentId: erna,
          title: "Gehtraining",
          category: "Pflege",
          minutes: 10,
          performedAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      )
    ).message,
    /erbracht/,
  );

  const fromTask = await createServiceRecord(ctx, {
    residentId: erna,
    catalogId: washing,
    minutes: 30,
    source: "task",
    sourceId: task,
  });
  assert.equal(
    (
      await failure(
        createServiceRecord(ctx, { residentId: erna, catalogId: washing, minutes: 30, source: "task", sourceId: task }),
      )
    ).status,
    409,
  );
  await createServiceRecord(ctx, {
    residentId: erna,
    title: "Gehtraining",
    category: "Pflege",
    minutes: 15,
    source: "intervention",
    sourceId: intervention,
    note: "Mit Rollator",
  });
  const wrong = await createServiceRecord(ctx, {
    residentId: erna,
    title: "Begleitung Arzt",
    category: "Organisation",
    minutes: 45,
  });

  day = await serviceDay(ctx, erna, day.day);
  assert.deepEqual(
    day.records.map((record) => [record.title, record.code, record.minutes, record.source]),
    [
      ["Körperpflege Ganzwäsche", "KP-01", 30, "task"],
      ["Gehtraining", "", 15, "intervention"],
      ["Begleitung Arzt", "", 45, "manual"],
    ],
  );
  // Die Aufgabe ist erfasst, die Massnahme bleibt mit Hinweis.
  assert.deepEqual(
    day.suggestions.map((item) => [item.source, item.detail]),
    [["intervention", "täglich · an diesem Tag 1× erfasst"]],
  );

  // Stornieren mit Begründung; zweimal geht nicht.
  assert.match((await failure(cancelServiceRecord(ctx, wrong.id, { reason: " " }))).message, /Begründung/);
  await cancelServiceRecord(ctx, wrong.id, { reason: "Falsche Person" });
  assert.equal((await failure(cancelServiceRecord(ctx, wrong.id, { reason: "Nochmals" }))).status, 409);

  // Stornierte Aufgaben-Leistung gibt die Aufgabe wieder frei.
  await cancelServiceRecord(ctx, fromTask.id, { reason: "Zeit falsch" });
  day = await serviceDay(ctx, erna, day.day);
  assert.ok(day.suggestions.some((item) => item.source === "task"));
  await createServiceRecord(ctx, { residentId: erna, catalogId: washing, minutes: 20, source: "task", sourceId: task });

  // Monatsauswertung: ohne stornierte Leistungen, Minuten je Bereich.
  const month = day.day.slice(0, 7);
  const report = await serviceReport(ctx, month, null);
  assert.equal(report.minutes, 35);
  assert.equal(report.count, 2);
  assert.deepEqual(report.categories, ["Pflege"]);
  assert.deepEqual(
    report.residents.map((resident) => [resident.name, resident.minutes, resident.byCategory]),
    [["Erna Muster", 35, { Pflege: 35 }]],
  );
  assert.equal((await serviceReport(ctx, month, f.units.b)).count, 0);
  assert.match((await failure(serviceReport(ctx, "2026-13", null))).message, /Monat/);

  // Protokoll der Akte.
  const audit = await q<{ entity_type: string; action: string }>(
    `SELECT entity_type, action FROM carecore_audit_log WHERE after_data->>'residentId' = $1 ORDER BY created_at`,
    [erna],
  );
  assert.deepEqual(
    audit.map((row) => `${row.entity_type}:${row.action}`),
    [
      "service_record:created",
      "service_record:created",
      "service_record:created",
      "service_record:cancelled",
      "service_record:cancelled",
      "service_record:created",
    ],
  );
});
