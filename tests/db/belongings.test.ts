import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { belongingInventory, belongingList, createBelonging, removeBelonging, updateBelonging } from "@/lib/belongings";
import { transferSheet } from "@/lib/resident-transfer";
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

test("Hilfsmittel und Gegenstände: erfassen, ändern mit Konfliktschutz, nicht mehr vorhanden, Überleitungsbogen", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const reader = {
    ...nurse,
    actor: { ...nurse.actor, permissions: nurse.actor.permissions.filter((p) => p !== "residents.write") },
  } as ApiContext;
  const erna = await createResident(f, "Erna Muster");

  assert.equal((await failure(createBelonging(reader, erna, { name: "Brille" }))).status, 403);
  assert.equal((await failure(createBelonging(nurse, erna, { name: " " }))).message, "Bitte den Gegenstand angeben.");
  assert.equal(
    (await failure(createBelonging(nurse, erna, { name: "Brille", kind: "geld" }))).message,
    "Bitte die Art des Gegenstands wählen.",
  );

  await createBelonging(nurse, erna, { name: "Ehering", kind: "personal", marking: "Gravur „E. 1962“" });
  let list = await createBelonging(nurse, erna, {
    name: "Hörgerät rechts",
    kind: "aid",
    marking: "Name auf Etui",
    location: "Nachttisch",
  });
  assert.deepEqual(
    list.belongings.map((item) => [item.name, item.kind]),
    [
      ["Hörgerät rechts", "aid"],
      ["Ehering", "personal"],
    ],
  );
  const hearing = list.belongings[0];
  list = await updateBelonging(nurse, hearing.id, { ...hearing, location: "Schublade Bad" });
  assert.equal(list.belongings[0].location, "Schublade Bad");
  assert.equal((await failure(updateBelonging(nurse, hearing.id, { ...hearing }))).status, 409, "alter Stand");

  assert.deepEqual((await transferSheet(nurse, erna)).belongings, [
    { name: "Hörgerät rechts", kind: "aid", marking: "Name auf Etui" },
    { name: "Ehering", kind: "personal", marking: "Gravur „E. 1962“" },
  ]);

  const ring = list.belongings[1];
  assert.equal((await failure(removeBelonging(nurse, ring.id, { reason: "" }))).message, "Bitte den Grund angeben.");
  list = await removeBelonging(nurse, ring.id, { reason: "der Tochter mitgegeben" });
  assert.equal(list.belongings[1].removed?.reason, "der Tochter mitgegeben");
  assert.equal((await failure(removeBelonging(nurse, ring.id, { reason: "nochmals" }))).status, 409);
  assert.deepEqual(
    (await transferSheet(nurse, erna)).belongings.map((item) => item.name),
    ["Hörgerät rechts"],
  );

  const audit = await q<{ action: string; after_data: Record<string, unknown> }>(
    `SELECT action, after_data FROM carecore_audit_log WHERE entity_type = 'resident_belonging'
       AND after_data ->> 'residentId' = $1 ORDER BY created_at`,
    [erna],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["created", "created", "updated", "removed"],
  );
  assert.equal(audit[2].after_data.storedAt, "Schublade Bad");

  const other = await fixture();
  const stranger = await apiContextFor(other, "anna");
  assert.equal((await failure(belongingList(stranger, erna))).status, 404);
  assert.equal((await failure(updateBelonging(stranger, hearing.id, { name: "x" }))).status, 404);
});

test("Wäsche- und Inventarliste: Kleidung und Einrichtung mit Anzahl, Reihenfolge, Liste ohne Entferntes, Überleitung ohne Wäsche", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const erna = await createResident(f, "Erna Muster");

  assert.equal(
    (await failure(createBelonging(nurse, erna, { name: "Socken", kind: "clothing", quantity: 0 }))).message,
    "Die Anzahl ist ungültig (1 bis 999).",
  );
  assert.equal(
    (await failure(createBelonging(nurse, erna, { name: "Socken", kind: "clothing", quantity: 1.5 }))).status,
    400,
  );
  await createBelonging(nurse, erna, { name: "Sessel", kind: "furniture", marking: "Namensschild unten" });
  await createBelonging(nurse, erna, { name: "Socken", kind: "clothing", quantity: 6, marking: "Namensetikett" });
  await createBelonging(nurse, erna, { name: "Pullover", kind: "clothing", quantity: 3 });
  let list = await createBelonging(nurse, erna, { name: "Brille", kind: "aid" });
  assert.deepEqual(
    list.belongings.map((item) => [item.kind, item.name, item.quantity]),
    [
      ["aid", "Brille", 1],
      ["clothing", "Pullover", 3],
      ["clothing", "Socken", 6],
      ["furniture", "Sessel", 1],
    ],
  );

  const pullover = list.belongings[1];
  list = await updateBelonging(nurse, pullover.id, { ...pullover, quantity: 4 });
  assert.equal(list.belongings[1].quantity, 4);
  await removeBelonging(nurse, list.belongings[3].id, { reason: "von der Familie abgeholt" });

  const inventory = await belongingInventory(nurse, erna);
  assert.equal(inventory.residentName, "Muster Erna");
  assert.deepEqual(
    inventory.belongings.map((item) => item.name),
    ["Brille", "Pullover", "Socken"],
    "nur vorhandene Gegenstände",
  );
  assert.deepEqual(
    (await transferSheet(nurse, erna)).belongings.map((item) => item.name),
    ["Brille"],
    "Kleidung und Einrichtung nicht im Überleitungsbogen",
  );

  const audit = await q<{ after: { quantity: number } }>(
    `SELECT after_data AS after FROM carecore_audit_log WHERE entity_type = 'resident_belonging' AND entity_id = $1
     AND action = 'updated'`,
    [pullover.id],
  );
  assert.equal(audit[0].after.quantity, 4);

  const g = await fixture();
  const stranger = await apiContextFor(g, "anna");
  assert.equal((await failure(belongingInventory(stranger, erna))).status, 404);
});
