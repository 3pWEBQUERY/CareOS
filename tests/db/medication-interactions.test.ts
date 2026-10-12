import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrder, parseOrderInput } from "@/lib/medication-orders";
import {
  createInteractionRule,
  deleteInteractionRule,
  listInteractionRules,
  residentInteractions,
  updateInteractionRule,
} from "@/lib/medication-interactions";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const rejected = (promise: Promise<unknown>) =>
  promise.then(
    () => "ok",
    (error: Error) => error.message,
  );

const order = (name: string) =>
  parseOrderInput({ name, amount: "1 Tablette", prescribedBy: "Dr. Test", startOn: "2026-01-01", times: ["08:00"] });

test("Wechselwirkungen: Hinweis der Einrichtung trifft laufende Verordnungen, protokolliert, nur eigene Einrichtung", async () => {
  const f = await fixture();
  const other = await fixture();
  const ctx = await apiContextFor(f, "leadA");
  const foreign = await apiContextFor(other, "leadA");
  const resident = await createResident(f);
  const marcoumar = await createOrder(ctx, resident, order("Marcoumar"));
  await createOrder(ctx, resident, order("Ibuprofen"));
  assert.deepEqual(await residentInteractions(ctx, resident), [], "ohne Hinweise keine Treffer");

  assert.equal(
    await rejected(
      createInteractionRule(ctx, {
        substanceA: "Ibuprofen",
        substanceB: "ibuprofen",
        severity: "major",
        description: "x",
        source: "y",
      }),
    ),
    "Bitte zwei verschiedene Wirkstoffe angeben.",
  );
  assert.equal(
    await rejected(
      createInteractionRule(ctx, {
        substanceA: "Ibuprofen",
        substanceB: "Marcoumar",
        severity: "major",
        description: "x",
      }),
    ),
    "Bitte die Quelle angeben (z. B. Apotheke, Fachinformation, Datum).",
  );
  const id = await createInteractionRule(ctx, {
    substanceA: "Ibuprofen",
    substanceB: "Marcoumar",
    severity: "major",
    description: "Erhöhtes Blutungsrisiko",
    recommendation: "Rücksprache mit dem Arzt",
    source: "Apotheke am Platz, 30.09.2026",
  });
  const findings = await residentInteractions(ctx, resident);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "major");
  assert.deepEqual([findings[0].orderA.name, findings[0].orderB.name], ["Ibuprofen", "Marcoumar"]);
  assert.equal(findings[0].source, "Apotheke am Platz, 30.09.2026");

  // Andere Einrichtung: sieht den Hinweis nicht, kann ihn weder ändern noch löschen.
  assert.equal((await listInteractionRules(foreign)).rules.length, 0);
  assert.equal(
    await rejected(
      updateInteractionRule(foreign, id, {
        substanceA: "A",
        substanceB: "B",
        severity: "minor",
        description: "x",
        source: "y",
      }),
    ),
    "Hinweis nicht gefunden.",
  );
  assert.equal(await rejected(deleteInteractionRule(foreign, id)), "Hinweis nicht gefunden.");
  assert.equal((await listInteractionRules(ctx)).status.licensedDatabase, null, "keine lizenzierte Datenbank");

  // Abgesetzte Verordnungen zählen nicht mehr.
  await q(`UPDATE carecore_medication_orders SET status = 'stopped' WHERE id = $1`, [marcoumar]);
  assert.deepEqual(await residentInteractions(ctx, resident), []);

  await deleteInteractionRule(ctx, id);
  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'medication_interaction' AND entity_id = $1 ORDER BY created_at`,
    [id],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["created", "deleted"],
  );
  assert.equal((await q(`SELECT 1 FROM carecore_medication_interactions WHERE id = $1`, [id])).length, 0);
});
