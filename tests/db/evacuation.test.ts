import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import { evacuationList } from "@/lib/evacuation";
import { recordSummary, updateMasterData } from "@/lib/resident-record";
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

test("Evakuierungsliste: Mobilität und Hinweise aus den Stammdaten, je Wohnbereich und Zimmer, Abwesende markiert", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");
  const hans = await createResident(f, "Hans Weg");

  const master = (await recordSummary(nurse, erna)).master;
  assert.equal(master.evacuationMobility, null);
  assert.equal(
    (await failure(updateMasterData(nurse, erna, { ...master, evacuationMobility: "kriechend" }))).message,
    "Ungültige Angabe zur Mobilität im Notfall.",
  );
  await updateMasterData(nurse, erna, {
    ...master,
    evacuationMobility: "wheelchair",
    evacuationNote: "Sauerstoff 2 l/min",
    resuscitationStatus: "dnr",
    resuscitationSource: "Patientenverfügung",
  });
  const saved = (await recordSummary(nurse, erna)).master;
  assert.equal(saved.evacuationMobility, "wheelchair");
  assert.equal(saved.evacuationNote, "Sauerstoff 2 l/min");
  const audit = await q<{ before_data: unknown; after_data: unknown }>(
    `SELECT before_data, after_data FROM carecore_audit_log WHERE entity_id = $1 AND action = 'evacuation_updated'`,
    [erna],
  );
  assert.deepEqual(
    audit.map((row) => [row.before_data, row.after_data]),
    [
      [
        { evacuationMobility: null, evacuationNote: null },
        { evacuationMobility: "wheelchair", evacuationNote: "Sauerstoff 2 l/min" },
      ],
    ],
  );

  await q(`UPDATE carecore_residents SET status = 'transferred' WHERE id = $1`, [hans]);
  await q(`UPDATE carecore_residents SET evacuation_mobility = 'bedridden' WHERE id = $1`, [otto]);

  const list = await evacuationList(nurse, f.units.a);
  assert.equal(list.units.length, 1);
  const people = list.units[0].rooms.flatMap((room) => room.people);
  const byId = Object.fromEntries(people.map((person) => [person.id, person]));
  assert.deepEqual(
    [byId[erna].mobility, byId[erna].note, byId[erna].resuscitation, byId[erna].absent],
    ["wheelchair", "Sauerstoff 2 l/min", "dnr", false],
  );
  assert.equal(byId[otto].mobility, "bedridden");
  assert.equal(byId[hans].absent, true);
  const counts = list.units[0].counts;
  assert.equal(counts.wheelchair, 1);
  assert.equal(counts.bedridden, 1);
  assert.equal(counts.absent, 1);
  assert.ok(list.generatedAt);

  // Ohne Wohnbereich: alle Wohnbereiche; fremder Wohnbereich nicht.
  assert.ok((await evacuationList(nurse, null)).units.length >= 1);
  const other = await fixture();
  assert.equal((await failure(evacuationList(nurse, other.units.a))).status, 404);
  assert.equal((await failure(evacuationList(nurse, "zimmer"))).status, 400);
  const foreign = await evacuationList(await apiContextFor(other, "anna"), null);
  assert.ok(!foreign.units.flatMap((unit) => unit.rooms.flatMap((room) => room.people)).some((p) => p.id === erna));
});
