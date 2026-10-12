import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import type { Permission } from "@/lib/server-data";
import {
  activeIsolations,
  createIsolation,
  declareOutbreak,
  endOutbreak,
  hygieneOverview,
  reviewIsolation,
  updateOutbreak,
} from "@/lib/hygiene";
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

const withPermission = (ctx: ApiContext, ...permissions: Permission[]): ApiContext => ({
  ...ctx,
  actor: { ...ctx.actor, permissions: [...ctx.actor.permissions, ...permissions] },
});

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

test("Isolation & Ausbruch: Pflichtangaben, Meldung an die Leitung, Überprüfung, Tagesliste und Verlauf", async () => {
  const f = await fixture();
  // Rollen der Fixture: Pflege ohne Dokumentationsrecht, Leitung ohne Qualitätsrecht; im Test ergänzt.
  const reader = await apiContextFor(f, "anna");
  const nurse = withPermission(reader, "documentation.write");
  const lead = withPermission(await apiContextFor(f, "leadA"), "quality.manage", "documentation.write");
  const erna = await createResident(f, "Erna Muster");
  const base = {
    residentId: erna,
    kind: "contact",
    reason: "Befund laut Labor, Anordnung Hausärztin",
    orderedBy: "Dr. Meier, Hausärztin",
    precautions: "Schutzkittel und Handschuhe bei der Pflege",
    reviewOn: day(2),
  };

  assert.equal((await failure(createIsolation(reader, base))).status, 403);
  assert.match((await failure(createIsolation(nurse, { ...base, reason: " " }))).message, /Anlass/);
  assert.match((await failure(createIsolation(nurse, { ...base, orderedBy: "" }))).message, /Angeordnet von/);
  assert.match((await failure(createIsolation(nurse, { ...base, kind: "x" }))).message, /Art der Isolation/);
  assert.match((await failure(createIsolation(nurse, { ...base, reviewOn: day(-2) }))).message, /Vergangenheit/);

  // Ausbruch: nur die Leitung; benachrichtigt die Mitarbeitenden des Wohnbereichs und die Leitung.
  assert.equal((await failure(declareOutbreak(nurse, { title: "Gastroenteritis" }))).status, 403);
  const { id: outbreakId } = await declareOutbreak(lead, {
    title: "Gastroenteritis WG A",
    careUnitId: f.units.a,
    measures: "Mahlzeiten im Zimmer",
  });
  const outbreakNotes = await q<{ user_id: string; priority: string }>(
    `SELECT user_id, priority FROM carecore_notifications WHERE type = 'outbreak' AND user_id = ANY($1::uuid[])`,
    [Object.values(f.people)],
  );
  const notified = new Set(outbreakNotes.map((row) => row.user_id));
  for (const person of ["anna", "max", "sam", "leadB"]) assert.ok(notified.has(f.people[person]), person);
  assert.ok(!notified.has(f.people.ben), "Mitarbeitende anderer Wohnbereiche werden nicht benachrichtigt");
  assert.ok(!notified.has(f.people.leadA), "die erfassende Person selbst nicht");
  assert.ok(outbreakNotes.every((row) => row.priority === "high"));

  const { id } = await createIsolation(nurse, { ...base, outbreakId });
  // Meldung an die Leitung.
  const leadNotes = await q<{ title: string }>(
    `SELECT title FROM carecore_notifications WHERE type = 'isolation' AND user_id = $1`,
    [f.people.leadA],
  );
  assert.deepEqual(
    leadNotes.map((row) => row.title),
    ["Kontaktisolation: Erna Muster"],
  );

  let overview = await hygieneOverview(reader, null);
  assert.equal(overview.canWrite, false);
  assert.equal(overview.active.length, 1);
  assert.equal(overview.active[0].outbreakId, outbreakId);
  assert.equal(overview.active[0].reviewDue, false);
  assert.deepEqual(
    overview.outbreaks.map((item) => [item.title, item.careUnitId, item.activeIsolations]),
    [["Gastroenteritis WG A", f.units.a, 1]],
  );
  assert.equal((await hygieneOverview(reader, f.units.b)).active.length, 0);

  // Tagesliste und Überleitungsbogen sehen die laufende Isolation.
  let worklist = await dailyWorklist(nurse, f.units.a);
  let items = worklist.residents.find((resident) => resident.id === erna)?.items ?? [];
  assert.deepEqual(
    items.filter((item) => item.kind === "isolation").map((item) => [item.label, item.tone]),
    [["Isolation beachten", "info"]],
  );
  await q(`UPDATE carecore_isolation_measures SET review_on = CURRENT_DATE - 1 WHERE id = $1`, [id]);
  worklist = await dailyWorklist(nurse, f.units.a);
  items = worklist.residents.find((resident) => resident.id === erna)?.items ?? [];
  assert.deepEqual(
    items.filter((item) => item.kind === "isolation").map((item) => [item.label, item.tone]),
    [["Isolation überprüfen", "attention"]],
  );
  assert.equal((await activeIsolations(nurse, erna)).length, 1);

  // Überprüfen: weiterführen, dann aufheben (mit Begründung).
  assert.match(
    (await failure(reviewIsolation(nurse, id, { outcome: "continue", note: "", nextReviewOn: day(3) }))).message,
    /Ergebnis/,
  );
  await reviewIsolation(nurse, id, { outcome: "continue", note: "Kontrollbefund ausstehend", nextReviewOn: day(3) });
  overview = await hygieneOverview(nurse, null);
  assert.equal(overview.active[0].reviewOn, day(3));
  assert.equal(overview.active[0].reviews.length, 1);
  await reviewIsolation(nurse, id, { outcome: "end", note: "Aufhebung laut Hausärztin" });
  assert.equal((await failure(reviewIsolation(nurse, id, { outcome: "end", note: "nochmals" }))).status, 409);
  overview = await hygieneOverview(nurse, null);
  assert.equal(overview.active.length, 0);
  assert.deepEqual(
    overview.ended.map((item) => [item.residentName, item.endNote]),
    [["Erna Muster", "Aufhebung laut Hausärztin"]],
  );

  // Ausbruch: Meldung an die Behörde nachtragen, dann beenden.
  await updateOutbreak(lead, outbreakId, {
    measures: "Mahlzeiten im Zimmer",
    authorityReportedOn: day(0),
    authorityNote: "Kantonsärztlicher Dienst",
  });
  assert.match((await failure(endOutbreak(lead, outbreakId, { note: "" }))).message, /Abschluss/);
  await endOutbreak(lead, outbreakId, { note: "Seit 7 Tagen keine neuen Fälle laut Hygienefachperson" });
  assert.equal((await failure(endOutbreak(lead, outbreakId, { note: "nochmals" }))).status, 409);
  overview = await hygieneOverview(nurse, null);
  assert.equal(overview.outbreaks.length, 0);
  assert.equal(overview.endedOutbreaks[0].authorityReportedOn, day(0));

  // Protokoll: Akte (Isolation) und Organisation (Ausbruch).
  const audit = await q<{ entity_type: string; action: string }>(
    `SELECT entity_type, action FROM carecore_audit_log WHERE entity_id = ANY($1::uuid[]) ORDER BY created_at`,
    [[id, outbreakId]],
  );
  assert.deepEqual(
    audit.map((row) => `${row.entity_type}:${row.action}`),
    [
      "outbreak:declared",
      "isolation_measure:created",
      "isolation_measure:reviewed",
      "isolation_measure:ended",
      "outbreak:updated",
      "outbreak:ended",
    ],
  );
});
