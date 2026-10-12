import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, assertResident } from "@/lib/api-context";
import { careInsights } from "@/lib/insights";
import { residentInsights } from "@/lib/resident-insights";
import { readSettings, readTerminology, saveTerminology } from "@/lib/settings";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

test("Terminologie: Einrichtung wählt Patient, ungültige Werte abgelehnt, Protokoll, andere Einstellungen bleiben", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "leadA");
  const before = await readSettings(ctx);
  assert.equal(await readTerminology(ctx), "resident");
  assert.equal(await saveTerminology(ctx, { value: "patient" }), "patient");
  assert.equal(await readTerminology(ctx), "patient");
  assert.deepEqual(await readSettings(ctx), before, "Einstellungen der Konfiguration bleiben unverändert");
  assert.equal(await status(saveTerminology(ctx, { value: "kunde" })), 400);
  assert.equal(await status(saveTerminology(ctx, {})), 400);
  assert.equal(await readTerminology(ctx), "patient");
  const [audit] = await q<{ before_data: unknown; after_data: unknown }>(
    `SELECT before_data, after_data FROM carecore_audit_log WHERE organization_id = $1 AND entity_type = 'setting' AND action = 'terminology'`,
    [f.org],
  );
  assert.deepEqual(audit, { before_data: { value: "resident" }, after_data: { value: "patient" } });
});

test("Terminologie: Kennzahlen und Meldungen des Servers folgen der Bezeichnung, die Kennzahl-ID bleibt", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "leadA");
  await createResident(f);
  const before = (await residentInsights(ctx)).kpis[0];
  assert.equal(before.label, "Bewohner kritisch");
  await saveTerminology(ctx, { value: "patient" });
  const after = (await residentInsights(ctx)).kpis[0];
  assert.equal(after.label, "Patienten kritisch");
  assert.equal(after.id, before.id, "„Meine Kennzahlen“ bleibt gültig");
  assert.match(after.note, /aktiven Patienten$/);
  assert.match(
    (await careInsights(ctx)).indicators.find((item) => item.id === "documentation")!.detail,
    /Patienten in den letzten 24 Stunden/,
  );
  const error = await assertResident(ctx, "00000000-0000-4000-8000-000000000000").catch((cause: Error) => cause);
  assert.equal((error as Error).message, "Patient nicht gefunden.");
});
