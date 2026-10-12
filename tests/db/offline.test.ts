import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createEntry } from "@/lib/documentation";
import { createNote } from "@/lib/handover";
import { createTask, setTaskStatus } from "@/lib/tasks";
import { addEntry, createWound, listEntries } from "@/lib/wounds";
import { addFluid, addMeal } from "@/lib/nutrition";
import { recordMeasurements } from "@/lib/vitals";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const count = async (table: string, residentId: string) =>
  (await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM ${table} WHERE resident_id = $1`, [residentId]))[0].n;

test("Offline-Warteschlange: dieselbe Anfrage wird nur einmal gespeichert", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const occurredAt = new Date(Date.now() - 2 * 3_600_000).toISOString();

  const docRequest = randomUUID();
  const entry = { residentId, category: "Pflege", body: "Offline dokumentiert", occurredAt };
  assert.ok(await createEntry(ctx, entry, docRequest));
  assert.equal(await createEntry(ctx, entry, docRequest), null, "Wiederholung");
  assert.equal(await count("carecore_documentation_entries", residentId), 1);
  // Der Eintrag behält den erfassten Zeitpunkt, nicht den der Übertragung.
  const [saved] = await q<{ occurred_at: Date }>(
    `SELECT occurred_at FROM carecore_documentation_entries WHERE resident_id = $1`,
    [residentId],
  );
  assert.equal(new Date(saved.occurred_at).toISOString(), occurredAt);

  const fluidRequest = randomUUID();
  assert.ok(await addFluid(ctx, { residentId, amountMl: 200, consumedAt: occurredAt }, fluidRequest));
  assert.equal(await addFluid(ctx, { residentId, amountMl: 200, consumedAt: occurredAt }, fluidRequest), null);
  assert.equal(await count("carecore_fluid_entries", residentId), 1);

  const mealRequest = randomUUID();
  const meal = { residentId, meal: "Frühstück", portionPercent: 100, eatenAt: occurredAt };
  await addMeal(ctx, meal, mealRequest);
  await addMeal(ctx, meal, mealRequest);
  assert.equal(await count("carecore_meal_entries", residentId), 1);

  const vitalsRequest = randomUUID();
  const vitals = { residentId, measuredAt: occurredAt, values: { Puls: { value: 72 }, Temperatur: { value: 36.8 } } };
  await recordMeasurements(ctx, vitals, vitalsRequest);
  await recordMeasurements(ctx, vitals, vitalsRequest);
  assert.equal(await count("carecore_vital_measurements", residentId), 2, "zwei Messwerte, einmal gespeichert");

  // Ohne Kennung (normale Eingabe) entsteht jeder Eintrag.
  await addFluid(ctx, { residentId, amountMl: 150 });
  await addFluid(ctx, { residentId, amountMl: 150 });
  assert.equal(await count("carecore_fluid_entries", residentId), 3);
  // Eine abgelehnte Anfrage hinterlässt keine Quittung und kann nach Korrektur erneut gesendet werden.
  const rejected = randomUUID();
  await assert.rejects(addFluid(ctx, { residentId, amountMl: 5 }, rejected), /Trinkmenge/);
  assert.ok(await addFluid(ctx, { residentId, amountMl: 50 }, rejected));
});

test("Offline: Übergabepunkt, Wundverlauf und erledigte Aufgabe behalten den Erfassungszeitpunkt und entstehen einmal", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const notedAt = new Date(Date.now() - 90 * 60_000).toISOString();

  const handover = randomUUID();
  const note = { residentId, content: "Offline: Sturzgefahr beachten", notedAt };
  assert.ok(await createNote(ctx, note, handover));
  assert.equal(await createNote(ctx, note, handover), null);
  const notes = await q<{ created_at: Date }>(`SELECT created_at FROM carecore_handovers WHERE resident_id = $1`, [
    residentId,
  ]);
  assert.equal(notes.length, 1);
  assert.equal(new Date(notes[0].created_at).toISOString(), notedAt);
  assert.match(
    (await createNote(ctx, { ...note, notedAt: new Date(Date.now() + 3_600_000).toISOString() }).catch((e) => e))
      .message,
    /Zukunft/,
  );

  const woundId = await createWound(ctx, {
    residentId,
    woundType: "Ulcus cruris",
    bodyLocation: "Unterarm links",
    discoveredOn: new Date().toISOString().slice(0, 10),
  });
  const woundRequest = randomUUID();
  const entry = { note: "Verband gewechselt", observedAt: notedAt };
  await addEntry(ctx, woundId, entry, woundRequest);
  await addEntry(ctx, woundId, entry, woundRequest);
  assert.equal((await listEntries(ctx, woundId)).entries.length, 1);

  const taskId = await createTask(ctx, { title: "Lagerung", residentId, category: "Pflege" });
  await setTaskStatus(ctx, taskId, { status: "completed", completedAt: notedAt });
  await setTaskStatus(ctx, taskId, { status: "completed", completedAt: notedAt });
  const [task] = await q<{ status: string; completed_at: Date }>(
    `SELECT status, completed_at FROM carecore_tasks WHERE id = $1`,
    [taskId],
  );
  assert.equal(task.status, "completed");
  assert.equal(new Date(task.completed_at).toISOString(), notedAt);
});

test("Quittungen werden nach 30 Tagen entfernt", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const old = randomUUID();
  await q(
    `INSERT INTO carecore_request_receipts (id, user_id, created_at) VALUES ($1, $2, NOW() - INTERVAL '31 days')`,
    [old, f.people.anna],
  );
  await addFluid(ctx, { residentId, amountMl: 100 }, randomUUID());
  const [left] = await q<{ n: number }>(`SELECT COUNT(*)::int AS n FROM carecore_request_receipts WHERE id = $1`, [
    old,
  ]);
  assert.equal(left.n, 0);
});
