import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { createOrder, listOrders, parseOrderInput, setOrderStatus } from "@/lib/medication-orders";
import { administerPrn, documentScheduledDose } from "@/lib/medication-round";
import { createEffectCheckReminders, listEffectChecks, recordEffectCheck } from "@/lib/medication-effect";
import { localDate, zonedToUtc } from "@/lib/roster/time";
import { apiContextFor as api, createResident as resident, fixture, q } from "../support/db";

const TZ = "Europe/Zurich";

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );
const message = async (promise: Promise<unknown>) =>
  promise.then(
    () => "",
    (error) => (error instanceof Error ? error.message : String(error)),
  );

const weekAgo = () => localDate(new Date(Date.now() - 7 * 86_400_000), TZ);
const stockOf = async (medicationName: string, org: string) =>
  Number(
    (
      await q<{ quantity: string }>(
        `SELECT SUM(st.quantity) AS quantity FROM carecore_medication_stock st JOIN carecore_medications m ON m.id = st.medication_id
         WHERE m.organization_id = $1 AND m.name = $2`,
        [org, medicationName],
      )
    )[0].quantity,
  );

test("Verordnung: Pflichtangaben und Reserve-Grenzen werden geprüft", () => {
  const base = { name: "Metformin", amount: "1 Tablette", prescribedBy: "Dr. Weber", startOn: "2026-01-01" };
  assert.throws(() => parseOrderInput({ ...base, times: [] }), /Einnahmezeit/);
  assert.throws(() => parseOrderInput({ ...base, amount: "" }), /Dosis/);
  assert.throws(
    () => parseOrderInput({ ...base, isPrn: true, minIntervalHours: 4, indication: "Schmerz" }),
    /maximale/,
  );
  assert.throws(() => parseOrderInput({ ...base, times: ["08:00"], endOn: "2025-12-31" }), /Enddatum/);
  const prn = parseOrderInput({
    ...base,
    isPrn: true,
    maxDosesPer24h: 4,
    minIntervalHours: 6,
    indication: "Schmerz",
    times: ["08:00"],
  });
  assert.deepEqual(prn.times, []);
  const regular = parseOrderInput({ ...base, times: ["20:00", "08:00", "08:00", "25:00"], maxDosesPer24h: 3 });
  assert.deepEqual(regular.times, ["08:00", "20:00"]);
  assert.equal(regular.maxDosesPer24h, null);
});

test("Regelgabe: Bestand wird genau einmal abgebucht und bei Korrektur zurückgebucht", async () => {
  const f = await fixture();
  const ctx = await api(f, "anna");
  const residentId = await resident(f);
  const orderId = await createOrder(
    ctx,
    residentId,
    parseOrderInput({
      name: "Metformin",
      strength: "500 mg",
      amount: "1 Tablette",
      stockQuantity: 1,
      prescribedBy: "Dr. Weber",
      startOn: weekAgo(),
      times: ["08:00"],
    }),
  );
  const [med] = await q<{ medication_id: string }>(
    `SELECT medication_id FROM carecore_medication_orders WHERE id = $1`,
    [orderId],
  );
  await q(
    `INSERT INTO carecore_medication_stock (id, organization_id, resident_id, medication_id, quantity, unit) VALUES ($1, $2, $3, $4, 10, 'Tabletten')`,
    [randomUUID(), f.org, residentId, med.medication_id],
  );
  const yesterday = localDate(new Date(Date.now() - 86_400_000), TZ);
  const scheduledAt = zonedToUtc(yesterday, "08:00", TZ).toISOString();

  assert.deepEqual(await documentScheduledDose(ctx, { orderId, scheduledAt, status: "administered" }), {
    stockNote: null,
  });
  assert.equal(await stockOf("Metformin", f.org), 9);
  // Nochmals „verabreicht“ bucht nicht doppelt ab.
  await documentScheduledDose(ctx, { orderId, scheduledAt, status: "administered" });
  assert.equal(await stockOf("Metformin", f.org), 9);
  // Korrektur auf „abgelehnt“ verlangt eine Begründung und bucht zurück.
  assert.match(await message(documentScheduledDose(ctx, { orderId, scheduledAt, status: "declined" })), /Begründung/);
  await documentScheduledDose(ctx, { orderId, scheduledAt, status: "declined", note: "Lehnt ab" });
  assert.equal(await stockOf("Metformin", f.org), 10);
  const [administration] = await q<{ status: string; count: string }>(
    `SELECT MIN(status) AS status, COUNT(*) AS count FROM carecore_medication_administrations WHERE medication_order_id = $1`,
    [orderId],
  );
  assert.deepEqual(administration, { status: "declined", count: "1" });
  // Eine Uhrzeit ohne Verordnung ist nicht dokumentierbar.
  const wrongSlot = zonedToUtc(yesterday, "09:00", TZ).toISOString();
  assert.equal(
    await status(documentScheduledDose(ctx, { orderId, scheduledAt: wrongSlot, status: "administered" })),
    409,
  );
  // Jede Dokumentation steht im Protokoll.
  const [audit] = await q<{ count: string }>(
    `SELECT COUNT(*) AS count FROM carecore_audit_log WHERE entity_type = 'medication_administration' AND organization_id = $1`,
    [f.org],
  );
  assert.equal(Number(audit.count), 3);
});

test("Reservegabe: Mindestabstand, Maximaldosis und Bestand werden eingehalten", async () => {
  const f = await fixture();
  const ctx = await api(f, "anna");
  const residentId = await resident(f);
  const orderId = await createOrder(
    ctx,
    residentId,
    parseOrderInput({
      name: "Paracetamol",
      strength: "500 mg",
      amount: "1 Tablette",
      stockQuantity: 1,
      prescribedBy: "Dr. Weber",
      startOn: weekAgo(),
      isPrn: true,
      maxDosesPer24h: 2,
      minIntervalHours: 4,
      indication: "Schmerzen",
    }),
  );
  // Ohne Bestand keine Gabe.
  assert.match(await message(administerPrn(ctx, { orderId, note: "Schmerzen NRS 5" })), /Bestand/);
  const [med] = await q<{ medication_id: string }>(
    `SELECT medication_id FROM carecore_medication_orders WHERE id = $1`,
    [orderId],
  );
  await q(
    `INSERT INTO carecore_medication_stock (id, organization_id, care_unit_id, medication_id, quantity, unit) VALUES ($1, $2, $3, $4, 5, 'Tabletten')`,
    [randomUUID(), f.org, f.units.a, med.medication_id],
  );
  assert.match(await message(administerPrn(ctx, { orderId, note: "" })), /Anlass/);
  await administerPrn(ctx, { orderId, note: "Schmerzen NRS 5" });
  assert.equal(await stockOf("Paracetamol", f.org), 4);
  assert.match(await message(administerPrn(ctx, { orderId, note: "Schmerzen NRS 6" })), /Mindestabstand/);
  // Nach Ablauf des Mindestabstands ist die zweite Gabe erlaubt, die dritte übersteigt die Maximaldosis.
  await q(
    `UPDATE carecore_medication_administrations SET administered_at = NOW() - INTERVAL '5 hours', scheduled_at = scheduled_at - INTERVAL '5 hours' WHERE medication_order_id = $1`,
    [orderId],
  );
  await administerPrn(ctx, { orderId, note: "Schmerzen NRS 6" });
  await q(
    `UPDATE carecore_medication_administrations SET administered_at = administered_at - INTERVAL '5 hours', scheduled_at = scheduled_at - INTERVAL '5 hours' WHERE medication_order_id = $1`,
    [orderId],
  );
  assert.match(await message(administerPrn(ctx, { orderId, note: "Schmerzen NRS 7" })), /Maximaldosis/);
  assert.equal(await stockOf("Paracetamol", f.org), 3);
  const orders = await listOrders(ctx, residentId);
  assert.equal(orders[0].administeredLast24h, 2);
  assert.equal(orders[0].wardStock, 3);
});

test("Wirkungskontrolle: Termin aus der Verordnung, Erinnerung einmal, Ergebnis in der Dokumentation", async () => {
  const f = await fixture();
  const base = await api(f, "anna");
  const ctx = { ...base, actor: { ...base.actor, permissions: [...base.actor.permissions, "medication.administer"] } };
  const residentId = await resident(f);
  const order = (effectCheckMinutes?: number) =>
    parseOrderInput({
      name: effectCheckMinutes ? "Morphin" : "Ibuprofen",
      strength: "10 mg",
      amount: "1 Tablette",
      stockQuantity: 1,
      prescribedBy: "Dr. Weber",
      startOn: weekAgo(),
      isPrn: true,
      maxDosesPer24h: 4,
      minIntervalHours: 4,
      indication: "Schmerzen",
      effectCheckMinutes,
    });
  // Ausserhalb von 5 Minuten bis 24 Stunden wird die Verordnung abgewiesen.
  assert.match(
    await message(Promise.resolve().then(() => order(2))),
    /Wirkungskontrolle muss zwischen 5 Minuten und 24 Stunden/,
  );
  const withCheck = await createOrder(ctx, residentId, order(60));
  const withoutCheck = await createOrder(ctx, residentId, order());
  assert.equal((await listOrders(ctx, residentId)).find((o) => o.id === withCheck)?.effectCheckMinutes, 60);
  for (const orderId of [withCheck, withoutCheck]) {
    const [med] = await q<{ medication_id: string }>(
      `SELECT medication_id FROM carecore_medication_orders WHERE id = $1`,
      [orderId],
    );
    await q(
      `INSERT INTO carecore_medication_stock (id, organization_id, care_unit_id, medication_id, quantity, unit) VALUES ($1, $2, $3, $4, 5, 'Tabletten')`,
      [randomUUID(), f.org, f.units.a, med.medication_id],
    );
    await administerPrn(ctx, { orderId, note: "Schmerzen NRS 6" });
  }

  // Nur die Gabe mit Vorgabe erhält einen Kontrolltermin (60 Minuten nach der Gabe).
  const [check] = await listEffectChecks(ctx, residentId);
  assert.equal((await listEffectChecks(ctx, residentId)).length, 1);
  assert.equal(check.medication, "Morphin 10 mg");
  assert.equal(check.overdue, false);
  const minutes = (Date.parse(check.dueAt) - Date.parse(check.administeredAt)) / 60_000;
  assert.ok(Math.abs(minutes - 60) < 1);

  // Noch nicht fällig: keine Erinnerung. Fällig: genau eine Erinnerung.
  const reminders = () =>
    q<{ n: number }>(
      "SELECT COUNT(*)::int AS n FROM carecore_notifications WHERE user_id = $1 AND type = 'medication_effect_check'",
      [f.people.anna],
    );
  await createEffectCheckReminders(ctx);
  assert.equal((await reminders())[0].n, 0);
  await q(
    "UPDATE carecore_medication_administrations SET effect_check_due_at = NOW() - INTERVAL '1 minute' WHERE id = $1",
    [check.administrationId],
  );
  await createEffectCheckReminders(ctx);
  await createEffectCheckReminders(ctx);
  assert.equal((await reminders())[0].n, 1);
  assert.equal((await listEffectChecks(ctx, residentId))[0].overdue, true);

  // „Nicht wirksam“ verlangt eine Beschreibung; das Ergebnis geht als wichtiger Eintrag in die Dokumentation.
  assert.equal(await status(recordEffectCheck(ctx, check.administrationId, { result: "none" })), 400);
  assert.equal(await status(recordEffectCheck(ctx, check.administrationId, { result: "vielleicht" })), 400);
  await recordEffectCheck(ctx, check.administrationId, { result: "none", note: "NRS 6, Hausarzt informiert" });
  assert.equal(await status(recordEffectCheck(ctx, check.administrationId, { result: "effective" })), 409);
  assert.equal((await listEffectChecks(ctx, residentId)).length, 0);
  const [entry] = await q<{ body: string; importance: string; category: string }>(
    "SELECT body, importance, category FROM carecore_documentation_entries WHERE resident_id = $1 AND title = 'Wirkungskontrolle'",
    [residentId],
  );
  assert.match(
    entry.body,
    /^Wirkungskontrolle Morphin 10 mg \(Gabe \d{2}:\d{2} Uhr\): Nicht wirksam – NRS 6, Hausarzt informiert$/,
  );
  assert.equal(entry.importance, "important");
  assert.equal(entry.category, "Medikation");
  const [audit] = await q<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM carecore_audit_log WHERE entity_id = $1 AND action = 'effect_checked'",
    [check.administrationId],
  );
  assert.equal(audit.n, 1);
});

test("Verordnung pausieren und absetzen: Grund ist Pflicht, abgesetzte erscheinen nicht mehr", async () => {
  const f = await fixture();
  const ctx = await api(f, "anna");
  const residentId = await resident(f);
  const orderId = await createOrder(
    ctx,
    residentId,
    parseOrderInput({
      name: "Ramipril",
      amount: "1 Tablette",
      prescribedBy: "Dr. Weber",
      startOn: weekAgo(),
      times: ["08:00"],
    }),
  );
  assert.match(await message(setOrderStatus(ctx, orderId, "paused", "")), /Grund/);
  await setOrderStatus(ctx, orderId, "paused", "Blutdruck tief");
  assert.equal((await listOrders(ctx, residentId))[0].status, "paused");
  // Pausiert ist keine Gabe dokumentierbar.
  const yesterday = localDate(new Date(Date.now() - 86_400_000), TZ);
  const scheduledAt = zonedToUtc(yesterday, "08:00", TZ).toISOString();
  assert.equal(await status(documentScheduledDose(ctx, { orderId, scheduledAt, status: "administered" })), 409);
  await setOrderStatus(ctx, orderId, "stopped", "Arztentscheid");
  assert.deepEqual(await listOrders(ctx, residentId), []);
  assert.equal(await status(setOrderStatus(ctx, orderId, "active", "")), 409);
});

test("Medikation einer fremden Organisation ist nicht erreichbar", async () => {
  const own = await fixture();
  const other = await fixture();
  const residentId = await resident(other);
  const ctx = await api(own, "anna");
  assert.equal(await status(listOrders(ctx, residentId)), 404);
  assert.equal(
    await status(
      createOrder(
        ctx,
        residentId,
        parseOrderInput({ name: "X", amount: "1", prescribedBy: "Dr. Y", startOn: weekAgo(), times: ["08:00"] }),
      ),
    ),
    404,
  );
});
