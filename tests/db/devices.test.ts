import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { createDeviceReminders, deviceOverview, recordDeviceCheck, retireDevice, saveDevice } from "@/lib/devices";
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

test("Geräte: Frist der Einrichtung, Prüfung mit Mängeln, nächste Prüfung, Erinnerung einmal je Zyklus, ausser Betrieb", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const lead = await apiContextFor(f, "leadA");
  const manager = {
    ...lead,
    actor: { ...lead.actor, permissions: [...new Set([...lead.actor.permissions, "quality.manage"])] },
  } as ApiContext;
  const withoutQuality = {
    ...nurse,
    actor: { ...nurse.actor, permissions: nurse.actor.permissions.filter((p) => p !== "quality.manage") },
  } as ApiContext;

  assert.equal((await failure(saveDevice(withoutQuality, { name: "Lifter" }))).status, 403);
  assert.equal((await failure(saveDevice(manager, { name: " " }))).message, "Bitte das Gerät benennen.");
  assert.equal(
    (await failure(saveDevice(manager, { name: "Lifter", intervalMonths: 0 }))).message,
    "Die Frist ist ungültig (1 bis 120 Monate).",
  );

  // Ohne Frist und ohne Datum: keine Fälligkeit, keine Erinnerung.
  const { id: scale } = await saveDevice(manager, { name: "Sitzwaage", category: "Waage" });
  const { id: lifter } = await saveDevice(manager, {
    name: "Patientenlifter EG",
    category: "Lifter",
    inventoryNumber: "INV-17",
    intervalMonths: 12,
    nextDueOn: "2026-01-15",
  });
  let overview = await deviceOverview(manager);
  const find = (id: string) => overview.devices.find((device) => device.id === id)!;
  assert.equal(find(scale).due, false);
  assert.equal(find(lifter).due, true, "Frist abgelaufen");
  assert.deepEqual(overview.categories, ["Lifter", "Waage"]);

  await createDeviceReminders(manager);
  await createDeviceReminders(manager);
  const reminders = () =>
    q<{ title: string }>(
      `SELECT title FROM carecore_notifications WHERE user_id = $1 AND type = 'device_check_due' ORDER BY created_at`,
      [f.people.leadA],
    );
  assert.deepEqual(
    (await reminders()).map((row) => row.title),
    ["Prüfung fällig: Patientenlifter EG"],
    "nur einmal je Zyklus",
  );

  assert.equal(
    (
      await failure(
        recordDeviceCheck(manager, lifter, { checkedOn: "2026-02-01", result: "defect", performedBy: "Haustechnik" }),
      )
    ).message,
    "Bitte die Mängel beschreiben.",
  );
  assert.equal(
    (await failure(recordDeviceCheck(manager, lifter, { checkedOn: "2999-01-01", result: "ok", performedBy: "x" })))
      .message,
    "Das Prüfdatum liegt in der Zukunft.",
  );
  await recordDeviceCheck(manager, lifter, {
    checkedOn: "2026-02-01",
    result: "defect",
    findings: "Gurt eingerissen",
    performedBy: "Servicefirma Muster",
  });
  overview = await deviceOverview(manager);
  assert.equal(find(lifter).nextDueOn, "2027-02-01", "Frist von 12 Monaten ab Prüfdatum");
  assert.equal(find(lifter).due, false);
  assert.equal(find(lifter).lastCheck?.result, "defect");

  // Ausdrückliches Datum geht der Frist vor.
  await recordDeviceCheck(manager, scale, {
    checkedOn: "2026-03-01",
    result: "ok",
    performedBy: "Haustechnik",
    nextDueOn: "2026-09-01",
  });
  overview = await deviceOverview(manager);
  assert.equal(find(scale).nextDueOn, "2026-09-01");
  assert.equal(find(scale).due, true);
  await createDeviceReminders(manager);
  assert.equal((await reminders()).length, 2);

  await retireDevice(manager, scale, { reason: "defekt und entsorgt" });
  assert.equal((await failure(retireDevice(manager, scale, { reason: "nochmals" }))).status, 409);
  assert.equal(
    (await failure(recordDeviceCheck(manager, scale, { checkedOn: "2026-03-02", result: "ok", performedBy: "x" })))
      .status,
    409,
  );
  overview = await deviceOverview(manager);
  assert.equal(find(scale).due, false, "ausser Betrieb: nicht mehr fällig");

  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'device' AND entity_id = $1 ORDER BY created_at`,
    [lifter],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["created", "checked"],
  );
  const other = await fixture();
  const stranger = await apiContextFor(other, "leadA");
  const strangerManager = {
    ...stranger,
    actor: { ...stranger.actor, permissions: [...new Set([...stranger.actor.permissions, "quality.manage"])] },
  } as ApiContext;
  assert.equal((await deviceOverview(strangerManager)).devices.length, 0);
  assert.equal(
    (
      await failure(
        recordDeviceCheck(strangerManager, lifter, { checkedOn: "2026-03-01", result: "ok", performedBy: "x" }),
      )
    ).status,
    404,
  );
});
