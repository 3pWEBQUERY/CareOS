import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { cancelEliminationEntry, createEliminationEntry, eliminationView } from "@/lib/elimination";
import { saveSetting } from "@/lib/settings";
import { dailyWorklist } from "@/lib/worklist";
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

const items = async (ctx: ApiContext, unit: string, residentId: string) =>
  ((await dailyWorklist(ctx, unit)).residents.find((resident) => resident.id === residentId)?.items ?? [])
    .filter((item) => item.kind === "elimination")
    .map((item) => [item.label, item.detail]);

test("Ausscheidung: Einträge, Bristol nur beim Stuhl, Storno, Hinweis nur mit Tageszahl der Einrichtung", async () => {
  const f = await fixture();
  const reader = await apiContextFor(f, "anna");
  const nurse = {
    ...reader,
    actor: { ...reader.actor, permissions: [...reader.actor.permissions, "documentation.write"] },
  } as ApiContext;
  const lead = await apiContextFor(f, "leadA");
  const admin = {
    ...lead,
    actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] },
  } as ApiContext;
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");

  assert.equal((await failure(createEliminationEntry(reader, { residentId: erna, kind: "stool" }))).status, 403);
  assert.equal(
    (await failure(createEliminationEntry(nurse, { residentId: erna, kind: "durchfall" }))).message,
    "Bitte die Art wählen.",
  );
  assert.equal(
    (await failure(createEliminationEntry(nurse, { residentId: erna, kind: "stool", bristol: 8 }))).message,
    "Die Stuhlform ist ungültig (Typ 1 bis 7).",
  );
  assert.equal(
    (await failure(createEliminationEntry(nurse, { residentId: erna, kind: "urine", bristol: 4 }))).message,
    "Die Stuhlform gehört nur zum Stuhlgang.",
  );
  assert.equal(
    (await failure(createEliminationEntry(nurse, { residentId: erna, kind: "material" }))).message,
    "Bitte das Material angeben.",
  );
  assert.equal(
    (await failure(createEliminationEntry(nurse, { residentId: erna, kind: "urine", volume: "eimer" }))).message,
    "Die Menge ist ungültig.",
  );

  const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
  // Zeitpunkt drei Tage zurück (erfassen lässt sich höchstens drei Tage rückwirkend).
  const threeDaysBack = (id: string) =>
    q(`UPDATE carecore_elimination_entries SET occurred_at = NOW() - INTERVAL '3 days' WHERE id = $1`, [id]);
  const requestId = randomUUID();
  const stool = await createEliminationEntry(
    nurse,
    { residentId: erna, kind: "stool", bristol: 4, volume: "medium", occurredAt: twoDaysAgo },
    requestId,
  );
  assert.ok(stool.id);
  await threeDaysBack(stool.id!);
  assert.deepEqual(
    await createEliminationEntry(
      nurse,
      { residentId: erna, kind: "stool", bristol: 4, occurredAt: twoDaysAgo },
      requestId,
    ),
    { id: null },
    "Offline-Wiederholung ohne zweiten Eintrag",
  );
  await createEliminationEntry(nurse, { residentId: erna, kind: "urine", volume: "large" });
  await createEliminationEntry(nurse, { residentId: erna, kind: "material", material: "Einlage" });

  let view = await eliminationView(nurse, erna, 7);
  assert.equal(view.entries.length, 3);
  assert.equal(view.daysSinceStool, 3);
  assert.equal(view.reminderDays, null);
  assert.equal(view.overdue, false);
  // Ohne Tageszahl der Einrichtung kein Hinweis.
  assert.deepEqual(await items(nurse, f.units.a, erna), []);

  await saveSetting(admin, "stoolReminderDays", { enabled: true, value: 3 });
  view = await eliminationView(nurse, erna, 7);
  assert.equal(view.overdue, true);
  assert.deepEqual(await items(nurse, f.units.a, erna), [["Stuhlgang beobachten", "letzter Stuhlgang vor 3 Tagen"]]);
  // Personen ohne Protokoll erhalten keinen Hinweis.
  assert.deepEqual(await items(nurse, f.units.a, otto), []);

  // Stuhlinkontinenz zählt als Stuhlgang; Storno nimmt ihn wieder heraus.
  const today = await createEliminationEntry(nurse, { residentId: erna, kind: "incontinence_stool", bristol: 6 });
  assert.equal((await eliminationView(nurse, erna, 7)).daysSinceStool, 0);
  assert.deepEqual(await items(nurse, f.units.a, erna), []);
  assert.equal((await failure(cancelEliminationEntry(nurse, today.id, { reason: "" }))).status, 400);
  await cancelEliminationEntry(nurse, today.id, { reason: "falsche Person" });
  assert.equal((await failure(cancelEliminationEntry(nurse, today.id, { reason: "nochmals" }))).status, 409);
  view = await eliminationView(nurse, erna, 7);
  assert.equal(view.daysSinceStool, 3);
  assert.equal(view.entries.find((entry) => entry.id === today.id)?.cancelled?.reason, "falsche Person");

  // Protokoll ohne Stuhlgang: Hinweis ab Beginn des Protokolls.
  await threeDaysBack((await createEliminationEntry(nurse, { residentId: otto, kind: "urine" })).id!);
  assert.deepEqual(await items(nurse, f.units.a, otto), [
    ["Stuhlgang beobachten", "kein Stuhlgang dokumentiert seit Beginn des Protokolls (3 Tage)"],
  ]);

  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'elimination_entry' AND after_data ->> 'residentId' = $1
     ORDER BY created_at`,
    [erna],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["created", "created", "created", "created", "cancelled"],
  );
  const other = await fixture();
  assert.equal((await failure(eliminationView(await apiContextFor(other, "anna"), erna, 3))).status, 404);
});
