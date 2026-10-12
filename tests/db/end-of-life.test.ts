import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import {
  applyDeathChecklist,
  endOfLifeView,
  readDeathChecklist,
  saveDeathChecklist,
  saveEndOfLifeWishes,
  updateDeathChecklistItem,
} from "@/lib/end-of-life";
import { recordExit } from "@/lib/resident-history";
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

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date());

test("Lebensende: Wünsche erfassen, Protokoll nur mit Abschnitten, Rechte und andere Einrichtung", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const reader = {
    ...nurse,
    actor: { ...nurse.actor, permissions: nurse.actor.permissions.filter((p) => p !== "residents.write") },
  } as ApiContext;
  const erna = await createResident(f, "Erna Muster");

  let view = await endOfLifeView(nurse, erna);
  assert.equal(view.canWrite, true);
  assert.equal(view.wishes.place, "");
  assert.equal(view.deceasedOn, null);
  assert.deepEqual(view.checklist, []);

  assert.equal((await failure(saveEndOfLifeWishes(reader, erna, { place: "Zimmer" }))).status, 403);
  assert.equal(
    (await failure(saveEndOfLifeWishes(nurse, erna, { discussedOn: "2999-01-01" }))).message,
    "Das Datum des Gesprächs darf nicht in der Zukunft liegen.",
  );
  assert.equal(
    (await failure(saveEndOfLifeWishes(nurse, erna, { discussedOn: "gestern" }))).message,
    "Das Datum des Gesprächs ist ungültig.",
  );

  view = await saveEndOfLifeWishes(nurse, erna, {
    place: "  Im eigenen Zimmer  ",
    spiritual: "Besuch der reformierten Seelsorge",
    notify: "Tochter Petra, auch nachts",
    discussedWith: "Erna Muster und Tochter",
    discussedOn: today(),
  });
  assert.equal(view.wishes.place, "Im eigenen Zimmer");
  assert.equal(view.wishes.funeral, "");
  assert.equal(view.wishes.discussedOn, today());
  assert.ok(view.wishes.updatedAt);
  view = await saveEndOfLifeWishes(nurse, erna, { ...view.wishes, funeral: "Erdbestattung" });
  assert.equal(view.wishes.funeral, "Erdbestattung");
  assert.equal(view.wishes.place, "Im eigenen Zimmer");

  // Inhalte stehen nicht im Protokoll, nur die geänderten Abschnitte.
  const audit = await q<{ action: string; after_data: { changedSections: string[] } }>(
    `SELECT action, after_data FROM carecore_audit_log WHERE entity_type = 'end_of_life_wishes' AND entity_id = $1
     ORDER BY created_at`,
    [erna],
  );
  assert.deepEqual(
    audit.map((row) => [row.action, row.after_data.changedSections]),
    [
      ["created", ["place", "spiritual", "notify", "discussedWith", "discussedOn"]],
      ["updated", ["funeral"]],
    ],
  );
  assert.ok(!JSON.stringify(audit).includes("Seelsorge"));

  const other = await fixture();
  assert.equal((await failure(endOfLifeView(await apiContextFor(other, "anna"), erna))).status, 404);
});

test("Todesfall: Checkliste der Einrichtung wird übernommen, abhaken nur einmal, später festgelegt nachträglich", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const lead = await apiContextFor(f, "leadA");
  const admin = {
    ...lead,
    actor: { ...lead.actor, permissions: [...lead.actor.permissions, "administration.manage"] },
  } as ApiContext;
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");

  // Keine Vorgabe: ohne festgelegte Punkte bleibt die Checkliste leer.
  assert.deepEqual(await readDeathChecklist(admin), []);
  assert.equal((await failure(saveDeathChecklist(nurse, { items: ["A"] }))).status, 403);
  assert.equal(
    (await failure(saveDeathChecklist(admin, { items: ["Ärztin informiert", "ärztin informiert"] }))).message,
    "Jeder Punkt darf nur einmal vorkommen.",
  );
  assert.equal(
    (await failure(saveDeathChecklist(admin, { items: Array.from({ length: 31 }, (_, i) => `Punkt ${i}`) }))).message,
    "Höchstens 30 Punkte möglich.",
  );

  await recordExit(nurse, otto, { kind: "deceased", date: today(), note: "Friedlich eingeschlafen." });
  assert.deepEqual((await endOfLifeView(nurse, otto)).checklist, []);
  assert.equal(
    (await failure(applyDeathChecklist(nurse, otto))).message,
    "Die Einrichtung hat noch keine Checkliste festgelegt.",
  );

  assert.deepEqual(
    await saveDeathChecklist(admin, {
      items: [" Ärztin informiert ", "", "Angehörige informiert", "Bestattung beauftragt"],
    }),
    ["Ärztin informiert", "Angehörige informiert", "Bestattung beauftragt"],
  );
  assert.equal((await failure(applyDeathChecklist(nurse, erna))).status, 409, "nur nach einem Todesfall");

  await recordExit(nurse, erna, { kind: "deceased", date: today(), note: "Im Beisein der Tochter verstorben." });
  let view = await endOfLifeView(nurse, erna);
  assert.equal(view.deceasedOn, today());
  assert.deepEqual(
    view.checklist.map((item) => [item.label, item.doneAt]),
    [
      ["Ärztin informiert", null],
      ["Angehörige informiert", null],
      ["Bestattung beauftragt", null],
    ],
  );

  // Spätere Änderungen der Einrichtung ändern übernommene Checklisten nicht.
  await saveDeathChecklist(admin, { items: ["Nur noch ein Punkt"] });
  assert.equal((await endOfLifeView(nurse, erna)).checklist.length, 3);

  const [first] = view.checklist;
  view = await updateDeathChecklistItem(nurse, first.id, { done: true, note: "telefonisch, kommt um 14 Uhr" });
  assert.ok(view.checklist[0].doneAt);
  assert.equal(view.checklist[0].note, "telefonisch, kommt um 14 Uhr");
  assert.ok(view.checklist[0].doneBy);
  assert.equal((await failure(updateDeathChecklistItem(nurse, first.id, { done: true }))).status, 409);
  view = await updateDeathChecklistItem(nurse, first.id, { done: false });
  assert.equal(view.checklist[0].doneAt, null);
  assert.equal(view.checklist[0].note, "");

  // Nachträglich übernehmen, aber nur einmal.
  view = await applyDeathChecklist(nurse, otto);
  assert.deepEqual(
    view.checklist.map((item) => item.label),
    ["Nur noch ein Punkt"],
  );
  assert.equal((await failure(applyDeathChecklist(nurse, otto))).status, 409);

  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'death_checklist' AND after_data ->> 'residentId' = $1
     ORDER BY created_at`,
    [erna],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["item_done", "item_reopened"],
  );
  const other = await fixture();
  assert.equal(
    (await failure(updateDeathChecklistItem(await apiContextFor(other, "anna"), first.id, { done: true }))).status,
    404,
  );
});
