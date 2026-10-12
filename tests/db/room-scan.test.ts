import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { roomResidents } from "@/lib/occupancy";
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

test("QR-Code am Zimmer: anwesende und verlegte Personen, nur eigene Einrichtung", async () => {
  const f = await fixture();
  const other = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");
  const [stay] = await q<{ room_id: string }>(
    `SELECT room_id FROM carecore_resident_stays WHERE resident_id = $1 AND ended_at IS NULL`,
    [erna],
  );
  const room = stay.room_id;

  let result = await roomResidents(nurse, room);
  assert.equal(result.room.careUnit, "Wohngruppe A");
  assert.deepEqual(result.residents, [{ id: erna, name: "Erna Muster", status: "active" }]);

  // Zweite Person im selben Zimmer, verlegt (Platz reserviert); geplante und ausgetretene Personen nicht.
  await q(`UPDATE carecore_resident_stays SET room_id = $1 WHERE resident_id = $2`, [room, otto]);
  await q(`UPDATE carecore_residents SET status = 'transferred' WHERE id = $1`, [otto]);
  const planned = await createResident(f, "Paul Geplant");
  await q(`UPDATE carecore_resident_stays SET room_id = $1 WHERE resident_id = $2`, [room, planned]);
  await q(`UPDATE carecore_residents SET status = 'planned' WHERE id = $1`, [planned]);
  const gone = await createResident(f, "Greta Alt");
  await q(`UPDATE carecore_resident_stays SET room_id = $1, ended_at = NOW() WHERE resident_id = $2`, [room, gone]);
  result = await roomResidents(nurse, room);
  assert.deepEqual(
    result.residents.map((resident) => [resident.name, resident.status]),
    [
      ["Otto Beispiel", "transferred"],
      ["Erna Muster", "active"],
    ],
  );

  assert.equal((await failure(roomResidents(await apiContextFor(other, "anna"), room))).status, 404);
  assert.equal((await failure(roomResidents(nurse, randomUUID()))).status, 404);
  assert.equal((await failure(roomResidents(nurse, "kein-zimmer"))).status, 400);
});
