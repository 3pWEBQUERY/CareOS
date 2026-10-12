import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import { kitchenList } from "@/lib/kitchen-list";
import { savePlan } from "@/lib/nutrition";
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

test("Küchenliste: Angaben aus dem Ernährungsplan je Wohnbereich, Personen ohne Plan erscheinen, fremde nicht", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const erna = await createResident(f, "Erna Muster");
  const otto = await createResident(f, "Otto Beispiel");
  const hans = await createResident(f, "Hans Weg");
  await q(`UPDATE carecore_residents SET status = 'transferred' WHERE id = $1`, [hans]);
  await savePlan(nurse, erna, {
    diet: "Diabetesangepasst",
    texture: "Püriert",
    allergies: "Nüsse",
    preferences: "kein Fisch",
    assistance: "Vollständige Unterstützung",
  });

  const list = await kitchenList(nurse, f.units.a);
  assert.equal(list.units.length, 1);
  const people = list.units[0].people;
  const byId = Object.fromEntries(people.map((person) => [person.id, person]));
  assert.deepEqual(
    [byId[erna].diet, byId[erna].texture, byId[erna].allergies, byId[erna].preferences, byId[erna].assistance],
    ["Diabetesangepasst", "Püriert", "Nüsse", "kein Fisch", "Vollständige Unterstützung"],
  );
  assert.ok(byId[erna].planUpdatedAt);
  assert.equal(byId[otto].planUpdatedAt, null, "ohne Plan, aber auf der Liste");
  assert.equal(byId[hans], undefined, "extern verlegt: nicht im Haus");
  assert.ok(list.generatedAt);

  const other = await fixture();
  assert.equal((await failure(kitchenList(nurse, other.units.a))).status, 404);
  assert.equal((await failure(kitchenList(nurse, "küche"))).status, 400);
  const foreign = await kitchenList(await apiContextFor(other, "anna"), null);
  assert.ok(!foreign.units.flatMap((unit) => unit.people).some((person) => person.id === erna));
});
