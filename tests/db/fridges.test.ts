import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { createFridgeReminders, fridgeOverview, recordFridgeReading, retireFridge, saveFridge } from "@/lib/fridges";
import { apiContextFor, fixture, q } from "../support/db";

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error;
  }
  assert.fail("Fehler erwartet");
}

test("Kühlschrank: Grenzen der Einrichtung, Massnahme ausserhalb, Erinnerungen einmal, ausser Betrieb", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const lead = await apiContextFor(f, "leadA");
  const manager = {
    ...lead,
    actor: { ...lead.actor, permissions: [...new Set([...lead.actor.permissions, "medication.manage"])] },
  } as ApiContext;
  const recorder = {
    ...nurse,
    actor: {
      ...nurse.actor,
      permissions: [...nurse.actor.permissions.filter((p) => p !== "medication.manage"), "medication.administer"],
    },
  } as ApiContext;
  const without = {
    ...nurse,
    actor: { ...nurse.actor, permissions: nurse.actor.permissions.filter((p) => !p.startsWith("medication.")) },
  } as ApiContext;

  assert.equal((await failure(saveFridge(recorder, { name: "Kühlschrank" }))).status, 403);
  assert.equal((await failure(fridgeOverview(without))).status, 403);
  assert.equal((await failure(saveFridge(manager, { name: " " }))).message, "Bitte den Kühlschrank benennen.");
  assert.equal(
    (await failure(saveFridge(manager, { name: "K", minCelsius: "8", maxCelsius: "2" }))).message,
    "Die untere Grenze muss unter der oberen liegen.",
  );
  assert.equal(
    (await failure(saveFridge(manager, { name: "K", intervalHours: 0 }))).message,
    "Der Messrhythmus ist ungültig (1 bis 744 Stunden).",
  );

  // Ohne Grenzen und Rhythmus: kein Hinweis, keine Erinnerung.
  const { id: plain } = await saveFridge(manager, { name: "Kühlschrank Cafeteria" });
  const { id: station } = await saveFridge(manager, {
    name: "Medikamentenkühlschrank EG",
    location: "Stationszimmer",
    minCelsius: "2,0",
    maxCelsius: "8",
    intervalHours: 24,
  });
  let overview = await fridgeOverview(recorder);
  const find = (id: string) => overview.fridges.find((fridge) => fridge.id === id)!;
  assert.equal(overview.canManage, false);
  assert.equal(find(plain).due, false);
  assert.equal(find(station).due, true, "Rhythmus festgelegt, noch keine Messung");
  assert.equal(find(station).minCelsius, 2);

  const reminders = (type: string) =>
    q<{ title: string; body: string }>(
      `SELECT title, body FROM carecore_notifications WHERE user_id = $1 AND type = $2 ORDER BY created_at`,
      [f.people.leadA, type],
    );
  await createFridgeReminders(manager);
  await createFridgeReminders(manager);
  await createFridgeReminders(recorder);
  assert.deepEqual(
    (await reminders("fridge_reading_due")).map((row) => row.title),
    ["Temperatur messen: Medikamentenkühlschrank EG"],
  );

  // Innerhalb der Grenzen; ohne Uhrzeit bzw. in der Zukunft abgelehnt.
  assert.equal(
    (await failure(recordFridgeReading(recorder, station, { celsius: "5" }))).message,
    "Bitte Datum und Uhrzeit der Messung angeben.",
  );
  assert.equal(
    (await failure(recordFridgeReading(recorder, station, { celsius: "5", measuredAt: "2099-01-01T08:00" }))).message,
    "Die Messung liegt in der Zukunft.",
  );
  const [{ now }] = await q<{ now: string }>(
    `SELECT to_char(NOW() AT TIME ZONE 'Europe/Zurich' - INTERVAL '1 hour', 'YYYY-MM-DD"T"HH24:MI') AS now`,
  );
  const ok = await recordFridgeReading(recorder, station, { celsius: "5,4", measuredAt: now });
  assert.equal(ok.outside, false);
  overview = await fridgeOverview(recorder);
  assert.equal(find(station).due, false, "Messung vor einer Stunde, Rhythmus 24 Stunden");
  assert.equal(find(station).lastReading?.celsius, 5.4);

  // Ausserhalb der Grenzen: Massnahme Pflicht; Grenzen der Messung bleiben bei späterer Änderung.
  assert.match(
    (await failure(recordFridgeReading(recorder, station, { celsius: "9,1", measuredAt: now }))).message,
    /ausserhalb der Grenzen der Einrichtung/,
  );
  const high = await recordFridgeReading(recorder, station, {
    celsius: 9.1,
    measuredAt: now,
    note: "Tür offen, nach 30 Minuten erneut gemessen",
  });
  assert.equal(high.outside, true);
  await saveFridge(manager, { id: station, name: "Medikamentenkühlschrank EG", minCelsius: 2, maxCelsius: 10 });
  overview = await fridgeOverview(manager);
  const last = find(station).lastReading!;
  assert.equal(last.outside, true);
  assert.equal(last.maxCelsius, 8, "Grenze zum Zeitpunkt der Messung");
  assert.equal(find(station).intervalHours, null);

  await createFridgeReminders(manager);
  await createFridgeReminders(manager);
  assert.deepEqual(await reminders("fridge_temperature_outside"), [
    {
      title: "Temperatur ausserhalb der Grenzen: Medikamentenkühlschrank EG",
      body: "9.1 °C · Massnahme: Tür offen, nach 30 Minuten erneut gemessen",
    },
  ]);

  // Protokoll.
  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'fridge' AND entity_id = $1 ORDER BY created_at`,
    [station],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["created", "measured", "measured", "updated"],
  );

  // Ausser Betrieb: keine Messung mehr, keine Erinnerung.
  assert.equal((await failure(retireFridge(manager, plain, { reason: "" }))).message, "Bitte den Grund angeben.");
  await retireFridge(manager, station, { reason: "Ersetzt" });
  assert.equal((await failure(recordFridgeReading(recorder, station, { celsius: 5, measuredAt: now }))).status, 409);
  assert.equal((await failure(retireFridge(manager, station, { reason: "x" }))).status, 409);
  overview = await fridgeOverview(manager);
  assert.ok(find(station).retired);
  assert.equal(find(station).due, false);
});
