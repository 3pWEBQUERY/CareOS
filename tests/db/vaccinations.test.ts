import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { transferSheet } from "@/lib/resident-transfer";
import { createVaccination, deleteVaccination, vaccinationList, vaccinationOverview } from "@/lib/vaccinations";
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

test("Impfungen: erfassen, Übersicht je Wohnbereich mit frei gewähltem Datum, Überleitungsbogen, Fehleintrag entfernen", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const reader = {
    ...nurse,
    actor: { ...nurse.actor, permissions: nurse.actor.permissions.filter((p) => p !== "residents.write") },
  } as ApiContext;
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");

  assert.equal(
    (await failure(createVaccination(reader, erna, { givenOn: "2026-01-01", target: "Grippe" }))).status,
    403,
  );
  assert.equal(
    (await failure(createVaccination(nurse, erna, { givenOn: "2999-01-01", target: "Grippe" }))).message,
    "Das Datum der Impfung liegt in der Zukunft.",
  );
  assert.equal(
    (await failure(createVaccination(nurse, erna, { givenOn: "2026-01-01", target: " " }))).message,
    "Bitte angeben, wogegen geimpft wurde.",
  );
  assert.equal(
    (await failure(createVaccination(nurse, erna, { givenOn: "2026-01-01", target: "Grippe", place: "zuhause" })))
      .message,
    "Bitte „im Haus“ oder „extern“ wählen.",
  );

  await createVaccination(nurse, erna, { givenOn: "2024-10-20", target: "Grippe", vaccine: "Präparat A", lot: "X1" });
  let list = await createVaccination(nurse, erna, {
    givenOn: "2025-10-15",
    target: "grippe",
    place: "external",
    givenBy: "Hausarztpraxis",
  });
  await createVaccination(nurse, otto, { givenOn: "2025-03-01", target: "Tetanus" });
  assert.deepEqual(
    list.vaccinations.map((item) => [item.givenOn, item.target, item.place]),
    [
      ["2025-10-15", "grippe", "external"],
      ["2024-10-20", "Grippe", "inhouse"],
    ],
  );
  assert.equal(
    list.targets[0].toLowerCase(),
    "grippe",
    "häufigste Bezeichnung zuerst, ohne Unterschied der Schreibweise",
  );

  // Ohne Datum: letzte dokumentierte Impfung; mit Datum nur danach.
  let overview = await vaccinationOverview(nurse, { target: "Grippe" });
  const unit = overview.units.find((item) => item.id === f.units.a)!;
  const status = (data: typeof overview, id: string) =>
    data.units.flatMap((item) => item.residents).find((resident) => resident.id === id)?.lastGivenOn;
  assert.ok(unit);
  assert.equal(overview.since, null);
  assert.equal(status(overview, erna), "2025-10-15");
  assert.equal(status(overview, otto), null);
  overview = await vaccinationOverview(nurse, { target: "Grippe", since: "2025-11-01" });
  assert.equal(status(overview, erna), null);
  assert.equal(
    (await failure(vaccinationOverview(nurse, { target: "Grippe", since: "2999-01-01" }))).message,
    "Das Datum „seit“ liegt in der Zukunft.",
  );

  const sheet = await transferSheet(nurse, erna);
  assert.deepEqual(sheet.vaccinations, [{ target: "grippe", givenOn: "2025-10-15" }]);

  const [latest] = list.vaccinations;
  assert.equal((await failure(deleteVaccination(nurse, latest.id, { reason: "" }))).status, 400);
  list = await deleteVaccination(nurse, latest.id, { reason: "doppelt erfasst" });
  assert.equal(list.vaccinations.length, 1);
  const audit = await q<{ action: string; after_data: Record<string, unknown> }>(
    `SELECT action, after_data FROM carecore_audit_log WHERE entity_type = 'vaccination' AND after_data ->> 'residentId' = $1
     ORDER BY created_at`,
    [erna],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["created", "created", "deleted"],
  );
  assert.equal(audit[0].after_data.against, "Grippe");

  const other = await fixture();
  const stranger = await apiContextFor(other, "anna");
  assert.equal((await failure(vaccinationList(stranger, erna))).status, 404);
  assert.equal((await failure(deleteVaccination(stranger, list.vaccinations[0].id, { reason: "x" }))).status, 404);
  assert.ok(!(await vaccinationOverview(stranger, {})).units.some((item) => item.residents.some((r) => r.id === erna)));
});
