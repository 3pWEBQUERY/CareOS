import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { createDiagnosis, deleteDiagnosis, diagnosisList, updateDiagnosis } from "@/lib/diagnoses";
import { transferSheet } from "@/lib/resident-transfer";
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

test("Diagnosen: erfassen, Form des ICD-10-Codes, abschliessen, Konflikt, Fehleintrag entfernen, Überleitungsbogen", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const reader = {
    ...nurse,
    actor: { ...nurse.actor, permissions: nurse.actor.permissions.filter((p) => p !== "residents.write") },
  } as ApiContext;
  const erna = await createResident(f, "Erna Muster");

  assert.equal((await failure(createDiagnosis(reader, erna, { label: "Hypertonie" }))).status, 403);
  assert.equal((await failure(createDiagnosis(nurse, erna, { label: " " }))).message, "Bitte die Diagnose angeben.");
  assert.equal(
    (await failure(createDiagnosis(nurse, erna, { label: "Hypertonie", icdCode: "Bluthochdruck" }))).message,
    "Der ICD-10-Code hat nicht die übliche Form (z. B. F03 oder I63.5).",
  );
  assert.equal(
    (await failure(createDiagnosis(nurse, erna, { label: "Hypertonie", sinceOn: "2999-01-01" }))).message,
    "Das Datum „seit“ liegt in der Zukunft.",
  );

  await createDiagnosis(nurse, erna, {
    label: "Arterielle Hypertonie",
    icdCode: "i10",
    kind: "secondary",
    sinceOn: "2015-03-01",
    source: "Arztbericht Dr. Muster",
  });
  let list = await createDiagnosis(nurse, erna, {
    label: "Demenz bei Alzheimer-Krankheit",
    icdCode: "G30.1+",
    kind: "main",
  });
  assert.equal(list.canWrite, true);
  assert.deepEqual(
    list.diagnoses.map((item) => [item.label, item.icdCode, item.kind]),
    [
      ["Demenz bei Alzheimer-Krankheit", "G30.1+", "main"],
      ["Arterielle Hypertonie", "I10", "secondary"],
    ],
    "Hauptdiagnose zuerst, Code in Grossbuchstaben",
  );

  const hypertension = list.diagnoses[1];
  assert.equal(
    (
      await failure(
        updateDiagnosis(nurse, hypertension.id, { ...hypertension, status: "resolved", resolvedOn: "2014-01-01" }),
      )
    ).message,
    "„Abgeschlossen am“ liegt vor dem Datum „seit“.",
  );
  list = await updateDiagnosis(nurse, hypertension.id, {
    ...hypertension,
    status: "resolved",
    resolvedOn: "2026-01-10",
  });
  assert.deepEqual(
    list.diagnoses.map((item) => [item.label, item.status, item.resolvedOn]),
    [
      ["Demenz bei Alzheimer-Krankheit", "current", null],
      ["Arterielle Hypertonie", "resolved", "2026-01-10"],
    ],
  );
  // Mit dem alten Stand geöffnet: Konflikt statt Überschreiben.
  assert.equal((await failure(updateDiagnosis(nurse, hypertension.id, { ...hypertension }))).status, 409);

  // Im Überleitungsbogen nur aktuelle Diagnosen.
  const sheet = await transferSheet(nurse, erna);
  assert.deepEqual(
    sheet.diagnoses.map((item) => item.label),
    ["Demenz bei Alzheimer-Krankheit"],
  );

  const main = list.diagnoses[0];
  assert.equal((await failure(deleteDiagnosis(nurse, main.id, { reason: "" }))).status, 400);
  list = await deleteDiagnosis(nurse, main.id, { reason: "bei der falschen Person erfasst" });
  assert.equal(list.diagnoses.length, 1);

  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'resident_diagnosis' AND after_data ->> 'residentId' = $1
     ORDER BY created_at`,
    [erna],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["created", "created", "updated", "deleted"],
  );
  const other = await fixture();
  const stranger = await apiContextFor(other, "anna");
  assert.equal((await failure(diagnosisList(stranger, erna))).status, 404);
  assert.equal((await failure(updateDiagnosis(stranger, hypertension.id, { label: "x" }))).status, 404);
});
