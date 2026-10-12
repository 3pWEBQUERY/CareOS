import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { resolveVisitItem, visitOverview } from "@/lib/visits";
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

test("Visite: Fragen je Hausarzt, Korrekturen, Rückmeldung als Arztvisite mit Protokoll", async () => {
  const f = await fixture();
  // Die Rollen der Fixture haben kein Dokumentationsrecht: einmal mit, einmal ohne.
  const reader = await apiContextFor(f, "anna");
  const ctx = {
    ...reader,
    actor: { ...reader.actor, permissions: [...reader.actor.permissions, "documentation.write"] },
  };
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");
  const paul = await createResident(f, "Paul Ohnearzt");
  await q(
    `UPDATE carecore_residents SET gp_name = 'Dr. Meier', gp_phone = '044 000 00 00' WHERE id = ANY($1::uuid[])`,
    [[erna, otto]],
  );

  const entry = async (resident: string, body: string, importance = "visit", amendedFrom: string | null = null) => {
    const id = randomUUID();
    await q(
      `INSERT INTO carecore_documentation_entries (id, resident_id, care_unit_id, author_user_id, category, title, body,
         importance, amended_from_id)
       VALUES ($1, $2, $3, $4, 'Beobachtung', 'Beobachtung', $5, $6, $7)`,
      [id, resident, f.units.a, f.people.anna, body, importance, amendedFrom],
    );
    return id;
  };
  const question = await entry(erna, "Schmerzmittel reicht nachts nicht");
  const original = await entry(otto, "Bitte Blutdruck anschauen");
  const corrected = await entry(otto, "Bitte Blutdruck und Ödeme anschauen", "visit", original);
  await entry(paul, "Hautstelle am Rücken");
  await entry(erna, "Normaler Eintrag", "standard");

  let overview = await visitOverview(ctx, null);
  assert.equal(overview.open, 3);
  assert.equal(overview.canWrite, true);
  assert.equal((await visitOverview(reader, null)).canWrite, false);
  assert.deepEqual(
    overview.groups.map((group) => [group.physician?.name ?? null, group.residents.map((r) => r.name)]),
    [
      ["Dr. Meier", ["Otto Beispiel", "Erna Muster"]],
      [null, ["Paul Ohnearzt"]],
    ],
  );
  assert.equal(overview.groups[0].physician?.phone, "044 000 00 00");
  // Korrigierte Einträge erscheinen nur in ihrer neuen Fassung.
  assert.deepEqual(
    overview.groups[0].residents[0].items.map((item) => item.id),
    [corrected],
  );
  assert.equal((await visitOverview(ctx, f.units.b)).open, 0);

  // Pflichtangaben und Rechte.
  assert.match((await failure(resolveVisitItem(ctx, question, { response: " " }))).message, /Rückmeldung/);
  assert.equal((await failure(resolveVisitItem(reader, question, { response: "Dosis erhöht" }))).status, 403);
  const standard = (
    await q<{ id: string }>(`SELECT id FROM carecore_documentation_entries WHERE body = 'Normaler Eintrag'`)
  )[0].id;
  assert.equal((await failure(resolveVisitItem(ctx, standard, { response: "Gesehen" }))).status, 404);

  const { responseEntryId } = await resolveVisitItem(ctx, question, { response: "Reserve neu verordnet, Plan folgt" });
  const [response] = await q<{ category: string; body: string; importance: string; metadata: Record<string, string> }>(
    `SELECT category, body, importance, metadata FROM carecore_documentation_entries WHERE id = $1`,
    [responseEntryId],
  );
  assert.equal(response.category, "Arztvisite");
  assert.equal(response.importance, "standard");
  assert.deepEqual(response.metadata, { visitQuestionId: question, physician: "Dr. Meier" });
  assert.equal((await failure(resolveVisitItem(ctx, question, { response: "Nochmals" }))).status, 409);

  // Die Rückmeldung zum korrigierten Eintrag schliesst auch das Original.
  await resolveVisitItem(ctx, corrected, { response: "Kontrolle in einer Woche", physician: "Dr. Vertretung" });
  overview = await visitOverview(ctx, null);
  assert.equal(overview.open, 1);
  assert.deepEqual(
    overview.groups.map((group) => group.physician),
    [null],
  );
  assert.deepEqual(
    overview.resolved.map((item) => [item.residentName, item.physician, item.response]),
    [
      ["Otto Beispiel", "Dr. Vertretung", "Kontrolle in einer Woche"],
      ["Erna Muster", "Dr. Meier", "Reserve neu verordnet, Plan folgt"],
    ],
  );

  const audit = await q<{ action: string; after_data: { physician: string } }>(
    `SELECT action, after_data FROM carecore_audit_log WHERE entity_id = $1`,
    [question],
  );
  assert.deepEqual(
    audit.map((row) => [row.action, row.after_data.physician]),
    [["visit_answered", "Dr. Meier"]],
  );
});
