import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { recordSummary, updateMasterData } from "@/lib/resident-record";
import { transferSheet } from "@/lib/resident-transfer";
import { ApiError } from "@/lib/api-context";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const base = { firstName: "Erna", lastName: "Muster", gender: "female", language: "de-CH" };

async function status(promise: Promise<unknown>) {
  try {
    await promise;
    return 200;
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error.status;
  }
}

test("Vorsorge und Vertretung: Stammdaten, eigener Protokolleintrag, Aktenkopf und Überleitungsbogen", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);

  // Ohne Eintrag: nicht erfasst und als fehlende Angabe gemeldet.
  let summary = await recordSummary(ctx, residentId);
  assert.equal(summary.master.advanceDirective, null);
  assert.ok(summary.missing.includes("Patientenverfügung"));
  assert.equal(summary.representative, null);

  // Datum in der Zukunft ist ungültig.
  assert.equal(
    await status(
      updateMasterData(ctx, residentId, { ...base, advanceDirective: "yes", advanceDirectiveOn: "2999-01-01" }),
    ),
    400,
  );

  await updateMasterData(ctx, residentId, {
    ...base,
    advanceDirective: "yes",
    advanceDirectiveOn: "2025-05-12",
    advanceDirectiveLocation: "Original bei der Tochter, Kopie unter Dokumente",
    careMandate: "yes",
    careMandateOn: "2024-01-10",
    careMandateEffectiveOn: "",
  });
  summary = await recordSummary(ctx, residentId);
  assert.equal(summary.master.advanceDirective, "yes");
  assert.equal(summary.master.advanceDirectiveOn, "2025-05-12");
  assert.equal(summary.master.advanceDirectiveLocation, "Original bei der Tochter, Kopie unter Dokumente");
  assert.equal(summary.master.careMandate, "yes");
  assert.equal(summary.master.careMandateEffectiveOn, null);
  assert.ok(!summary.missing.includes("Patientenverfügung"));

  // „Liegt nicht vor“ leert Datum und Ort.
  await updateMasterData(ctx, residentId, {
    ...base,
    advanceDirective: "no",
    advanceDirectiveOn: "2025-05-12",
    advanceDirectiveLocation: "x",
    careMandate: "yes",
    careMandateOn: "2024-01-10",
  });
  summary = await recordSummary(ctx, residentId);
  assert.equal(summary.master.advanceDirective, "no");
  assert.equal(summary.master.advanceDirectiveOn, null);
  assert.equal(summary.master.advanceDirectiveLocation, null);

  // Jede Änderung der Vorsorge mit eigenem Eintrag; unverändert gespeichert: keiner.
  await updateMasterData(ctx, residentId, {
    ...base,
    advanceDirective: "no",
    careMandate: "yes",
    careMandateOn: "2024-01-10",
  });
  const audit = await q<{ action: string; after_data: { advanceDirective: string } }>(
    `SELECT action, after_data FROM carecore_audit_log WHERE entity_id = $1 AND action = 'advance_care_updated'
     ORDER BY created_at`,
    [residentId],
  );
  assert.deepEqual(
    audit.map((row) => row.after_data.advanceDirective),
    ["yes", "no"],
  );

  // Vertretung: Kontaktperson mit Rolle; die selbst bestimmte (Vorsorgeauftrag) geht der angehörigen vor.
  await q(
    `INSERT INTO carecore_resident_contacts (id, resident_id, full_name, phone, is_primary, is_emergency_contact, representative_role)
     VALUES ($1, $2, 'Paul Muster', '+41 79 111 11 11', TRUE, TRUE, 'relative'),
            ($3, $2, 'Petra Muster', '+41 79 222 22 22', FALSE, FALSE, 'mandate'),
            ($4, $2, 'Nachbar Ohne Rolle', NULL, FALSE, FALSE, NULL)`,
    [randomUUID(), residentId, randomUUID(), randomUUID()],
  );
  summary = await recordSummary(ctx, residentId);
  assert.deepEqual(summary.representative, { name: "Petra Muster", role: "mandate", phone: "+41 79 222 22 22" });

  const sheet = await transferSheet(ctx, residentId);
  assert.equal(sheet.master.careMandate, "yes");
  assert.equal(sheet.representative?.name, "Petra Muster");
  assert.equal(sheet.country, "CH");
});
