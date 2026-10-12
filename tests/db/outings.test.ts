import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { markOuting, outingDay } from "@/lib/outings";
import { parseAppointmentInput } from "@/lib/server-appointments";
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

const base = {
  kind: "resident",
  residentId: randomUUID(),
  title: "Zahnarzt",
  category: "Arzttermin",
  startsAt: "2026-05-04T08:00:00.000Z",
  endsAt: "2026-05-04T09:00:00.000Z",
  status: "scheduled",
};

test("Termin ausser Haus: Eingaben (Transport, Abholung vor Terminende, nur für Personen)", () => {
  const outside = parseAppointmentInput({
    ...base,
    outside: true,
    transport: "taxi",
    transportNote: " Taxi Muster, mit Rollstuhl ",
    pickupAt: "2026-05-04T07:30:00.000Z",
    escort: "Tochter",
    documents: "Überleitungsbogen",
  });
  assert.ok(!("error" in outside));
  assert.equal(outside.outside, true);
  assert.equal(outside.transport, "taxi");
  assert.equal(outside.transportNote, "Taxi Muster, mit Rollstuhl");
  assert.equal(outside.pickupAt, "2026-05-04T07:30:00.000Z");
  assert.deepEqual(parseAppointmentInput({ ...base, outside: true, transport: "rakete" }), {
    error: "Bitte einen gültigen Transport auswählen.",
  });
  assert.deepEqual(parseAppointmentInput({ ...base, outside: true, pickupAt: "2026-05-04T09:00:00.000Z" }), {
    error: "Die Abholung muss vor dem Terminende liegen.",
  });
  // Nicht ausser Haus bzw. Wohnbereichsaufgabe: Transportangaben werden verworfen.
  const inside = parseAppointmentInput({ ...base, transport: "taxi", escort: "x", pickupAt: base.startsAt });
  assert.ok(!("error" in inside));
  assert.deepEqual([inside.outside, inside.transport, inside.escort, inside.pickupAt], [false, null, "", null]);
  const task = parseAppointmentInput({
    ...base,
    kind: "care_unit_task",
    careUnitId: randomUUID(),
    category: "Organisation",
    outside: true,
  });
  assert.ok(!("error" in task));
  assert.equal(task.outside, false);
});

test("Fahrdienst: Tagesliste nach Abholung, Abfahrt, Rückkehr, rückgängig, Rechte, Protokoll", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const reader = {
    ...nurse,
    actor: { ...nurse.actor, permissions: nurse.actor.permissions.filter((p) => p !== "residents.write") },
  } as ApiContext;
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");
  const appointment = async (resident: string, startsAt: string, values: Record<string, unknown> = {}) => {
    const id = randomUUID();
    await q(
      `INSERT INTO carecore_resident_appointments (id, organization_id, kind, resident_id, title, category, starts_at,
        ends_at, status, outside, transport, pickup_at, escort, documents)
       VALUES ($1, $2, 'resident', $3, $4, $5, $6::timestamptz, $6::timestamptz + INTERVAL '1 hour', $7, $8, $9, $10, $11, $12)`,
      [
        id,
        f.org,
        resident,
        values.title ?? "Termin",
        values.category ?? "Arzttermin",
        startsAt,
        values.status ?? "scheduled",
        values.outside ?? true,
        values.transport ?? null,
        values.pickupAt ?? null,
        values.escort ?? "",
        values.documents ?? "",
      ],
    );
    return id;
  };
  // 4. Mai 2026 in Zürich (Sommerzeit, UTC+2).
  const dentist = await appointment(erna, "2026-05-04T08:00:00Z", {
    title: "Zahnarzt",
    transport: "taxi",
    pickupAt: "2026-05-04T07:30:00Z",
    escort: "Tochter",
    documents: "Überleitungsbogen",
  });
  const hairdresser = await appointment(otto, "2026-05-04T07:00:00Z", { title: "Coiffeur", category: "Coiffeur" });
  await appointment(otto, "2026-05-04T06:00:00Z", { title: "Visite im Haus", outside: false });
  await appointment(otto, "2026-05-04T22:30:00Z", { title: "Nächster Tag in Zürich" });

  let day = await outingDay(nurse, "2026-05-04");
  assert.deepEqual(
    day.outings.map((item) => item.title),
    ["Coiffeur", "Zahnarzt"],
    "nur ausser Haus, nach Abholung bzw. Beginn",
  );
  const first = day.outings[1];
  assert.equal(first.transport, "taxi");
  assert.equal(first.escort, "Tochter");
  assert.equal(first.residentName, "Muster Erna");
  assert.equal((await outingDay(nurse, "2026-05-05")).outings.length, 1);
  assert.equal((await failure(outingDay(nurse, "04.05.2026"))).message, "Das Datum ist ungültig.");

  assert.equal((await failure(markOuting(reader, dentist, { event: "departed" }))).status, 403);
  assert.equal(
    (await failure(markOuting(nurse, dentist, { event: "returned" }))).message,
    "Bitte zuerst die Abfahrt vermerken.",
  );
  assert.equal((await failure(markOuting(nurse, dentist, { event: "undo" }))).status, 409);
  await markOuting(nurse, dentist, { event: "departed" });
  assert.equal((await failure(markOuting(nurse, dentist, { event: "departed" }))).status, 409);
  await markOuting(nurse, dentist, { event: "returned" });
  day = await outingDay(reader, "2026-05-04");
  const done = day.outings.find((item) => item.id === dentist)!;
  assert.ok(done.departed && done.returned);
  assert.ok(done.returned.at >= done.departed.at);
  assert.equal(day.canWrite, false);

  // Rückgängig nimmt zuerst die Rückkehr, dann die Abfahrt zurück.
  await markOuting(nurse, dentist, { event: "undo" });
  day = await outingDay(nurse, "2026-05-04");
  assert.ok(day.outings.find((item) => item.id === dentist)!.departed);
  assert.equal(day.outings.find((item) => item.id === dentist)!.returned, null);
  await markOuting(nurse, dentist, { event: "undo" });
  day = await outingDay(nurse, "2026-05-04");
  assert.equal(day.outings.find((item) => item.id === dentist)!.departed, null);

  await q(`UPDATE carecore_resident_appointments SET status = 'cancelled' WHERE id = $1`, [hairdresser]);
  assert.equal(
    (await failure(markOuting(nurse, hairdresser, { event: "departed" }))).message,
    "Der Termin ist abgesagt.",
  );

  // Nur Termine ausser Haus der eigenen Einrichtung.
  const other = await fixture();
  const stranger = await apiContextFor(other, "anna");
  assert.equal((await failure(markOuting(stranger, dentist, { event: "departed" }))).status, 404);

  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'resident_appointment' AND entity_id = $1 ORDER BY created_at`,
    [dentist],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["departed", "returned", "return_undone", "departure_undone"],
  );

  // Ein Termin, der nicht mehr ausser Haus ist, darf keine Abfahrt behalten (Datenbankregel).
  await assert.rejects(
    q(`UPDATE carecore_resident_appointments SET outside = FALSE, departed_at = NOW() WHERE id = $1`, [dentist]),
  );
});
