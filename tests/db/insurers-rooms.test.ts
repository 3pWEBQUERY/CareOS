import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { readInsurers, saveInsurers } from "@/lib/insurers";
import { DEFAULT_INSURERS } from "@/lib/insurers-shared";
import { recordSummary, updateMasterData } from "@/lib/resident-record";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );
const message = async (promise: Promise<unknown>) =>
  promise.then(
    () => "",
    (error) => (error as Error).message,
  );

test("Versicherungen: Vorgabe je Land, eigene Liste der Administration, Auswahl in den Stammdaten", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const lead = await apiContextFor(f, "leadA");
  const admin = {
    ...lead,
    actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] },
  };
  const erna = await createResident(f, "Erna Muster");

  // Vorgabe für das Land der Einrichtung (Schweiz), nach Wechsel des Landes die deutsche Liste.
  assert.deepEqual(await readInsurers(nurse), { country: "CH", insurers: DEFAULT_INSURERS.CH, custom: false });
  await q(`UPDATE carecore_organizations SET country = 'DE' WHERE id = $1`, [f.org]);
  assert.deepEqual((await readInsurers(nurse)).insurers, DEFAULT_INSURERS.DE);
  await q(`UPDATE carecore_organizations SET country = 'CH' WHERE id = $1`, [f.org]);

  // In den Stammdaten nur Versicherungen aus der Liste.
  const master = (await recordSummary(nurse, erna)).master;
  assert.match(
    await message(updateMasterData(nurse, erna, { ...master, insurer: "Erfundene Kasse" })),
    /aus der Liste/,
  );
  await updateMasterData(nurse, erna, { ...master, insurer: "Helsana" });
  assert.equal((await recordSummary(nurse, erna)).master.insurer, "Helsana");

  // Nur die Administration passt die Liste an; leere Zeilen fallen weg, doppelte Einträge nicht erlaubt.
  assert.equal(await status(saveInsurers(lead, { insurers: ["Helsana"] })), 403);
  assert.equal(await status(saveInsurers(admin, { insurers: ["Helsana", "helsana"] })), 400);
  assert.equal(await status(saveInsurers(admin, { insurers: [" "] })), 400);
  const own = await saveInsurers(admin, { insurers: ["Hauskasse Muster", " ", "CSS"] });
  assert.deepEqual(own, { country: "CH", insurers: ["Hauskasse Muster", "CSS"], custom: true });
  // Die eigene Liste gilt nur für das Land, in dem sie erfasst wurde.
  await q(`UPDATE carecore_organizations SET country = 'AT' WHERE id = $1`, [f.org]);
  assert.deepEqual((await readInsurers(nurse)).insurers, DEFAULT_INSURERS.AT);
  await q(`UPDATE carecore_organizations SET country = 'CH' WHERE id = $1`, [f.org]);

  // Ein bisheriger Wert, der nicht mehr in der Liste steht, bleibt unverändert gültig; neu wählbar ist er nicht.
  const saved = (await recordSummary(nurse, erna)).master;
  await updateMasterData(nurse, erna, { ...saved, religion: "Evangelisch-reformiert" });
  assert.equal((await recordSummary(nurse, erna)).master.insurer, "Helsana");
  const otto = await createResident(f, "Otto Beispiel");
  const ottoMaster = (await recordSummary(nurse, otto)).master;
  assert.match(await message(updateMasterData(nurse, otto, { ...ottoMaster, insurer: "Helsana" })), /aus der Liste/);
  await updateMasterData(nurse, otto, { ...ottoMaster, insurer: "Hauskasse Muster" });

  // Vorgabe wiederherstellen; beides steht im Protokoll.
  assert.deepEqual(await saveInsurers(admin, { insurers: null }), {
    country: "CH",
    insurers: DEFAULT_INSURERS.CH,
    custom: false,
  });
  const audit = await q<{ after_data: { insurers: unknown } }>(
    `SELECT after_data FROM carecore_audit_log WHERE entity_id = $1 AND action = 'insurers' ORDER BY created_at`,
    [f.org],
  );
  assert.deepEqual(
    audit.map((row) => row.after_data.insurers),
    [["Hauskasse Muster", "CSS"], "Vorgabe"],
  );
});

test("Konfession: Auswahl je Land, früher frei erfasster Wert bleibt gültig", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const erna = await createResident(f, "Erna Muster");
  const master = (await recordSummary(nurse, erna)).master;
  assert.match(await message(updateMasterData(nurse, erna, { ...master, religion: "Erfunden" })), /aus der Liste/);
  await updateMasterData(nurse, erna, { ...master, religion: "Christkatholisch" });
  // In Österreich gilt die österreichische Liste; der gespeicherte Wert bleibt unverändert gültig.
  await q(`UPDATE carecore_organizations SET country = 'AT' WHERE id = $1`, [f.org]);
  const saved = (await recordSummary(nurse, erna)).master;
  assert.equal(saved.religion, "Christkatholisch");
  await updateMasterData(nurse, erna, { ...saved, firstName: "Erna" });
  await updateMasterData(nurse, erna, { ...saved, religion: "Evangelisch A.B." });
  assert.match(
    await message(updateMasterData(nurse, erna, { ...saved, religion: "Christkatholisch" })),
    /aus der Liste/,
  );
});

test("Zimmerwechsel in den Stammdaten: nur Zimmer der Einrichtung mit freiem Bett, Aufenthalt im Verlauf", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");
  const [ottoRoom] = await q<{ room_id: string }>(
    `SELECT room_id FROM carecore_resident_stays WHERE resident_id = $1 AND ended_at IS NULL`,
    [otto],
  );
  const free = randomUUID();
  await q(`INSERT INTO carecore_rooms (id, care_unit_id, name, beds) VALUES ($1, $2, 'Zimmer 201', 2)`, [
    free,
    f.units.b,
  ]);
  const master = (await recordSummary(nurse, erna)).master;

  // Belegtes Zimmer (ein Bett) und Zimmer einer anderen Einrichtung werden abgelehnt.
  assert.equal(await status(updateMasterData(nurse, erna, { ...master, roomId: ottoRoom.room_id })), 409);
  const other = await fixture();
  const foreign = randomUUID();
  await q(`INSERT INTO carecore_rooms (id, care_unit_id, name) VALUES ($1, $2, 'Zimmer 9')`, [foreign, other.units.a]);
  assert.equal(await status(updateMasterData(nurse, erna, { ...master, roomId: foreign })), 400);

  // Wechsel in den anderen Wohnbereich: bisheriger Aufenthalt endet, neuer beginnt.
  await updateMasterData(nurse, erna, { ...master, roomId: free });
  const stays = await q<{ room_id: string; care_unit_id: string; open: boolean }>(
    `SELECT room_id, care_unit_id, ended_at IS NULL AS open FROM carecore_resident_stays
     WHERE resident_id = $1 ORDER BY started_at`,
    [erna],
  );
  assert.equal(stays.length, 2);
  assert.equal(stays[0].open, false);
  assert.deepEqual([stays[1].room_id, stays[1].care_unit_id, stays[1].open], [free, f.units.b, true]);
  const [audit] = await q<{ after_data: { room: string } }>(
    `SELECT after_data FROM carecore_audit_log WHERE entity_id = $1 AND action = 'room_changed'`,
    [erna],
  );
  assert.equal(audit.after_data.room, "Zimmer 201");

  // Gleiches Zimmer erneut: kein weiterer Aufenthalt.
  await updateMasterData(nurse, erna, { ...master, roomId: free });
  const [count] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_resident_stays WHERE resident_id = $1`,
    [erna],
  );
  assert.equal(count.n, 2);
});
