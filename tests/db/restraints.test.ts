import { test } from "node:test";
import assert from "node:assert/strict";
import { createRestraint, listRestraints, reviewRestraint, updateRestraint } from "@/lib/restraints";
import { dailyWorklist } from "@/lib/worklist";
import { transferSheet } from "@/lib/resident-transfer";
import { ApiError } from "@/lib/api-context";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

const base = (residentId: string) => ({
  residentId,
  kind: "bed_rails",
  description: "beidseitig",
  reason: "Sturz aus dem Bett in der Nacht, Verletzungsgefahr",
  alternatives: "Niederflurbett und Sensormatte geprüft; Niederflurbett nicht verfügbar",
  schedule: "nachts 22–6 Uhr",
  orderedBy: "Laura Leitung, Pflegedienstleitung",
  residentConsent: "incapable",
  residentInformed: true,
  representativeName: "Peter Muster (Sohn)",
  representativeInformedOn: null,
  approvalReference: "",
  startsAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
  plannedUntil: null,
  reviewOn: day(-1),
});

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error;
  }
  assert.fail("Fehler erwartet");
}

test("FBM: Pflichtangaben, Überprüfung, Ende, Protokoll und Erinnerung", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f, "Erna Muster");

  // Pflichtangaben und plausible Daten.
  assert.match((await failure(createRestraint(ctx, { ...base(residentId), reason: " " }))).message, /Grund/);
  assert.match((await failure(createRestraint(ctx, { ...base(residentId), alternatives: "" }))).message, /mildere/);
  assert.match((await failure(createRestraint(ctx, { ...base(residentId), orderedBy: "" }))).message, /Anordnende/);
  assert.match(
    (await failure(createRestraint(ctx, { ...base(residentId), kind: "other", description: "" }))).message,
    /beschreiben/,
  );
  assert.match(
    (await failure(createRestraint(ctx, { ...base(residentId), reviewOn: day(-5) }))).message,
    /vor dem Beginn/,
  );
  // Ohne Bearbeitungsrecht (Leitung mit Leserecht in der Fixture) nicht erlaubt.
  const reader = await apiContextFor(f, "leadA");
  assert.equal((await failure(createRestraint(reader, base(residentId)))).status, 403);

  const { id } = await createRestraint(ctx, base(residentId));
  let [measure] = await listRestraints(ctx, residentId);
  assert.equal(measure.kind, "bed_rails");
  assert.equal(measure.reviewDue, true, "Überprüfung seit gestern fällig");
  assert.equal(measure.representativeInformedOn, null);

  // Tagesliste: Überprüfung fällig und Vertretung noch nicht informiert.
  const worklist = await dailyWorklist(ctx, f.units.a);
  const items = worklist.residents.find((resident) => resident.id === residentId)?.items ?? [];
  assert.deepEqual(
    items.filter((item) => item.kind === "restraint").map((item) => item.label),
    ["FBM überprüfen", "Vertretung über FBM informieren"],
  );
  assert.equal(items.find((item) => item.kind === "restraint")?.href, `/c/bewohner?resident=${residentId}&ansicht=fbm`);

  // Korrektur: Vertretung informiert.
  await updateRestraint(ctx, id, { ...base(residentId), representativeInformedOn: day(0) });
  [measure] = await listRestraints(ctx, residentId);
  assert.equal(measure.representativeInformedOn, day(0));

  // Überleitungsbogen zeigt die laufende Massnahme.
  const sheet = await transferSheet(ctx, residentId);
  assert.deepEqual(
    sheet.restraints.map((item) => [item.label, item.schedule]),
    [["Bettseitenteile", "nachts 22–6 Uhr"]],
  );

  // Überprüfung: weiterführen braucht einen künftigen Termin.
  assert.match(
    (await failure(reviewRestraint(ctx, id, { outcome: "continue", note: "weiter nötig" }))).message,
    /Nächste Überprüfung fehlt/,
  );
  assert.match(
    (await failure(reviewRestraint(ctx, id, { outcome: "continue", note: "weiter nötig", nextReviewOn: day(-1) })))
      .message,
    /Vergangenheit/,
  );
  await reviewRestraint(ctx, id, { outcome: "continue", note: "Weiterhin Sturzgefahr", nextReviewOn: day(14) });
  [measure] = await listRestraints(ctx, residentId);
  assert.equal(measure.reviewOn, day(14));
  assert.equal(measure.reviewDue, false);
  assert.equal(measure.reviews.length, 1);

  // Beenden mit Begründung; danach keine Änderung mehr.
  await reviewRestraint(ctx, id, { outcome: "end", note: "Niederflurbett geliefert" });
  [measure] = await listRestraints(ctx, residentId);
  assert.ok(measure.endedAt);
  assert.equal(measure.endReason, "Niederflurbett geliefert");
  assert.equal((await failure(updateRestraint(ctx, id, base(residentId)))).status, 409);
  assert.equal((await failure(reviewRestraint(ctx, id, { outcome: "end", note: "x" }))).status, 409);
  assert.equal((await transferSheet(ctx, residentId)).restraints.length, 0);

  // Jede Änderung im Protokoll, mit Bezug zur Person.
  const audit = await q<{ action: string; resident: string }>(
    `SELECT action, after_data->>'residentId' AS resident FROM carecore_audit_log
     WHERE entity_type = 'restraint_measure' AND entity_id = $1 ORDER BY created_at`,
    [id],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["created", "updated", "reviewed", "ended"],
  );
  assert.ok(audit.every((row) => row.resident === residentId));
});
