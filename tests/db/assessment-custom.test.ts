import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { customInstruments, deactivateCustomInstrument, saveCustomInstrument } from "@/lib/assessment-custom";
import { assessmentsOverview, dueAssessments, recordAssessment, residentHistory } from "@/lib/assessments";
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

const question = (label: string) => ({
  label,
  options: [
    { value: 0, label: "nicht beobachtet" },
    { value: 1, label: "gelegentlich" },
    { value: 2, label: "dauernd" },
  ],
});

test("Eigene Instrumente: nur Administration, mit Quelle, Fassungen, Einschätzung und Fälligkeit", async () => {
  const f = await fixture();
  const lead = await apiContextFor(f, "leadA");
  const admin = {
    ...lead,
    actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] },
  } as ApiContext;
  const reader = await apiContextFor(f, "anna");
  const nurse = {
    ...reader,
    actor: { ...reader.actor, permissions: [...reader.actor.permissions, "documentation.write"] },
  } as ApiContext;
  const erna = await createResident(f, "Erna Muster");
  const base = {
    name: "Schmerzbeobachtung (Haus)",
    category: "Schmerz",
    source: "Eigenes Formular der Einrichtung, Fassung 2026",
    reassessDays: 14,
    items: [question("Atmung"), question("Gesichtsausdruck")],
    bands: [{ min: 3, max: 4, label: "Laut Formular: Fachperson beiziehen" }],
  };

  assert.equal((await failure(saveCustomInstrument(lead, null, base))).status, 403);
  assert.match((await failure(saveCustomInstrument(admin, null, { ...base, source: "" }))).message, /Quelle/);
  assert.match((await failure(saveCustomInstrument(admin, null, { ...base, reassessDays: 0 }))).message, /Intervall/);
  assert.match(
    (
      await failure(
        saveCustomInstrument(admin, null, { ...base, items: [{ label: "x", options: [{ value: 1, label: "a" }] }] }),
      )
    ).message,
    /2 bis 20 Antworten/,
  );
  assert.match(
    (
      await failure(
        saveCustomInstrument(admin, null, {
          ...base,
          bands: [
            { min: 0, max: 2, label: "a" },
            { min: 2, max: 4, label: "b" },
          ],
        }),
      )
    ).message,
    /überschneiden/,
  );

  const { id, code } = await saveCustomInstrument(admin, null, base);
  assert.match(code, /^EIGEN-/);
  // Vor der ersten Einschätzung wird die Fassung direkt geändert.
  await saveCustomInstrument(admin, id, { ...base, name: "Schmerzbeobachtung" });
  let list = await customInstruments(admin, true);
  assert.deepEqual(
    list.map((item) => [item.name, item.version, item.active]),
    [["Schmerzbeobachtung", "1", true]],
  );

  // Im Überblick neben dem Katalog; Einschätzung zählt die Punkte der Einrichtung.
  const overview = await assessmentsOverview(nurse);
  const instrument = overview.instruments.find((item) => item.code === code)!;
  assert.equal(instrument.custom?.source, base.source);
  assert.ok(
    overview.instruments.some((item) => item.code === "BRADEN"),
    "Katalog bleibt",
  );
  const result = await recordAssessment(nurse, { residentId: erna, instrument: code, answers: { q1: 2, q2: 1 } });
  assert.equal(result.score, 3);
  assert.equal(result.riskLabel, "Laut Formular: Fachperson beiziehen");
  assert.equal(
    (await failure(recordAssessment(nurse, { residentId: erna, instrument: code, answers: { q1: 5, q2: 1 } }))).message,
    "Bitte alle Fragen des Instruments beantworten.",
  );
  const history = await residentHistory(nurse, erna, code);
  assert.deepEqual(
    history.map((item) => [item.name, item.score, item.riskLabel]),
    [["Schmerzbeobachtung", 3, "Laut Formular: Fachperson beiziehen"]],
  );

  // Nach der ersten Einschätzung: neue Fassung, frühere Ergebnisse bleiben bei Fassung 1.
  await saveCustomInstrument(admin, id, {
    ...base,
    name: "Schmerzbeobachtung",
    items: [...base.items, question("Körperhaltung")],
  });
  list = await customInstruments(admin, true);
  assert.deepEqual(
    list.map((item) => [item.version, item.items.length, item.active]),
    [["2", 3, true]],
  );
  const versions = await q<{ version: string; active: boolean }>(
    `SELECT version, active FROM carecore_assessments WHERE organization_id = $1 AND code = $2 ORDER BY version`,
    [f.org, code],
  );
  assert.deepEqual(versions, [
    { version: "1", active: false },
    { version: "2", active: true },
  ]);
  assert.equal((await failure(saveCustomInstrument(admin, id, base))).status, 409, "alte Fassung nicht mehr änderbar");
  const second = await recordAssessment(nurse, {
    residentId: erna,
    instrument: code,
    answers: { q1: 0, q2: 0, q3: 1 },
  });
  assert.equal(second.score, 1);
  assert.equal(second.riskLabel, null);
  assert.equal((await residentHistory(nurse, erna, code)).length, 2);

  // Fälligkeit nach dem Intervall der Einrichtung.
  await q(`UPDATE carecore_assessment_records SET next_due_on = CURRENT_DATE - 1 WHERE resident_id = $1`, [erna]);
  assert.ok((await dueAssessments(nurse)).some((item) => item.code === code && item.kind === "overdue"));

  // Nicht mehr anbieten: verschwindet aus der Auswahl, Ergebnisse bleiben.
  await deactivateCustomInstrument(admin, list[0].id);
  assert.ok(!(await assessmentsOverview(nurse)).instruments.some((item) => item.code === code));
  assert.equal(
    (await failure(recordAssessment(nurse, { residentId: erna, instrument: code, answers: { q1: 0, q2: 0, q3: 0 } })))
      .message,
    "Unbekanntes Instrument.",
  );
  assert.equal((await residentHistory(nurse, erna, code)).length, 2);

  // Andere Einrichtung sieht das Instrument nicht.
  const other = await fixture();
  assert.ok(
    !(await assessmentsOverview(await apiContextFor(other, "anna"))).instruments.some((item) => item.code === code),
  );
});
