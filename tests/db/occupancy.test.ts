import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import type { Permission } from "@/lib/server-data";
import {
  cancelAdmission,
  confirmAdmission,
  occupancyOverview,
  planAdmission,
  saveRoom,
  saveWaitlistEntry,
  setWaitlistStatus,
} from "@/lib/occupancy";
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

const withPermission = (ctx: ApiContext, ...permissions: Permission[]): ApiContext => ({
  ...ctx,
  actor: { ...ctx.actor, permissions: [...ctx.actor.permissions, ...permissions] },
});

test("Belegung & Eintritt: Plätze, Warteliste, Eintritt planen, bestätigen und absagen, Zimmer", async () => {
  const f = await fixture();
  // Pflege der Fixture darf Personen bearbeiten, die Leitung nicht; Zimmer verwaltet die Administration.
  const nurse = await apiContextFor(f, "anna");
  const lead = await apiContextFor(f, "leadA");
  const admin = withPermission(lead, "administration.manage");
  const erna = await createResident(f, "Erna Muster");
  const unitA = () => occupancyOverview(nurse).then((o) => o.units.find((unit) => unit.id === f.units.a)!);
  const today = (await occupancyOverview(nurse)).today;
  const inDays = (days: number) => {
    const date = new Date(`${today}T12:00:00Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  let unit = await unitA();
  assert.deepEqual([unit.places, unit.occupied, unit.reserved, unit.free], [1, 1, 0, 0]);
  const ernaRoom = unit.rooms.find((room) => room.occupants.some((person) => person.id === erna))!;

  // Zimmer: nur Administration; zwei Betten.
  assert.equal(
    (await failure(saveRoom(nurse, null, { careUnitId: f.units.a, name: "Zimmer 105", beds: 2 }))).status,
    403,
  );
  const { id: room } = await saveRoom(admin, null, { careUnitId: f.units.a, name: "Zimmer 105", beds: 2 });
  assert.equal(
    (await failure(saveRoom(admin, null, { careUnitId: f.units.a, name: "Zimmer 105", beds: 1 }))).status,
    409,
  );
  unit = await unitA();
  assert.deepEqual([unit.places, unit.free], [3, 2]);

  // Warteliste: Pflichtangaben, keine Anmeldung in der Zukunft, Rechte.
  const base = {
    firstName: "Otto",
    lastName: "Beispiel",
    registeredOn: today,
    desiredCareUnitId: f.units.a,
    contactName: "Petra Beispiel (Tochter)",
    note: "Einstufung laut Abklärung folgt",
  };
  assert.equal((await failure(saveWaitlistEntry(lead, null, base))).status, 403);
  assert.match((await failure(saveWaitlistEntry(nurse, null, { ...base, lastName: "" }))).message, /Nachname/);
  assert.match(
    (await failure(saveWaitlistEntry(nurse, null, { ...base, registeredOn: inDays(1) }))).message,
    /Zukunft/,
  );
  const { id: otto } = await saveWaitlistEntry(nurse, null, base);
  const { id: lina } = await saveWaitlistEntry(nurse, null, { ...base, firstName: "Lina", lastName: "Kunz" });
  const { id: hans } = await saveWaitlistEntry(nurse, null, { ...base, firstName: "Hans", lastName: "Graf" });
  await setWaitlistStatus(nurse, otto, { status: "offered" });
  assert.match((await failure(setWaitlistStatus(nurse, hans, { status: "withdrawn" }))).message, /Grund/);
  assert.equal((await failure(setWaitlistStatus(nurse, hans, { status: "admitted" }))).status, 400);

  // Eintritt planen: nur mit freiem Bett und nicht in der Vergangenheit.
  assert.equal(
    (await failure(planAdmission(nurse, otto, { roomId: ernaRoom.id, admittedOn: inDays(3) }))).status,
    409,
    "Zimmer von Erna ist voll",
  );
  assert.match(
    (await failure(planAdmission(nurse, otto, { roomId: room, admittedOn: inDays(-1) }))).message,
    /Vergangenheit/,
  );
  const { residentId: ottoId } = await planAdmission(nurse, otto, { roomId: room, admittedOn: inDays(3) });
  const { residentId: linaId } = await planAdmission(nurse, lina, { roomId: room, admittedOn: inDays(5) });
  assert.equal(
    (await failure(planAdmission(nurse, hans, { roomId: room, admittedOn: inDays(5) }))).status,
    409,
    "beide Betten reserviert",
  );
  assert.equal((await failure(planAdmission(nurse, otto, { roomId: room, admittedOn: inDays(3) }))).status, 409);

  let overview = await occupancyOverview(nurse);
  unit = overview.units.find((item) => item.id === f.units.a)!;
  assert.deepEqual([unit.occupied, unit.reserved, unit.free], [1, 2, 0]);
  assert.deepEqual(
    overview.planned.map((item) => [item.name, item.admittedOn, item.waitlistId]),
    [
      ["Otto Beispiel", inDays(3), otto],
      ["Lina Kunz", inDays(5), lina],
    ],
  );
  assert.deepEqual(
    overview.waitlist.map((item) => item.lastName),
    ["Graf"],
  );
  const [planned] = await q<{ status: string; notes: string }>(
    `SELECT status, notes FROM carecore_residents WHERE id = $1`,
    [ottoId],
  );
  assert.deepEqual(planned, { status: "planned", notes: "Einstufung laut Abklärung folgt" });

  // Zimmer: Betten nicht unter die Belegung, belegt nicht stilllegen.
  assert.match((await failure(saveRoom(admin, room, { name: "Zimmer 105", beds: 1 }))).message, /2 Betten belegt/);
  assert.match(
    (await failure(saveRoom(admin, room, { name: "Zimmer 105", beds: 2, active: false }))).message,
    /stillgelegt/,
  );

  // Bestätigen: erst am Eintrittstag; Absagen: Bett frei, Warteliste wartet wieder.
  assert.match((await failure(confirmAdmission(nurse, ottoId, { admittedOn: inDays(1) }))).message, /Eintrittstag/);
  await confirmAdmission(nurse, ottoId, { admittedOn: today });
  assert.equal((await failure(confirmAdmission(nurse, ottoId, { admittedOn: today }))).status, 409);
  assert.match((await failure(cancelAdmission(nurse, linaId, { reason: "" }))).message, /Grund/);
  await cancelAdmission(nurse, linaId, { reason: "Anderer Platz gewählt" });

  overview = await occupancyOverview(nurse);
  unit = overview.units.find((item) => item.id === f.units.a)!;
  assert.deepEqual([unit.occupied, unit.reserved, unit.free], [2, 0, 1]);
  assert.deepEqual(overview.planned, []);
  const linaEntry = overview.waitlist.find((item) => item.id === lina)!;
  assert.equal(linaEntry.status, "waiting");
  assert.equal(linaEntry.statusNote, "Eintritt abgesagt: Anderer Platz gewählt");
  const [ottoNow] = await q<{ status: string; admitted_on: string }>(
    `SELECT status, admitted_on::text FROM carecore_residents WHERE id = $1`,
    [ottoId],
  );
  assert.deepEqual(ottoNow, { status: "active", admitted_on: today });

  await setWaitlistStatus(nurse, hans, { status: "withdrawn", note: "Anderes Heim" });
  overview = await occupancyOverview(nurse);
  assert.deepEqual(overview.closed.map((item) => [item.lastName, item.status]).sort(), [
    ["Beispiel", "admitted"],
    ["Graf", "withdrawn"],
  ]);

  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_id = $1 ORDER BY created_at`,
    [ottoId],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["admission_planned", "admission_confirmed"],
  );
});
