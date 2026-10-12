import { test } from "node:test";
import assert from "node:assert/strict";
import { reportEvent } from "@/lib/quality";
import { residentInsights } from "@/lib/resident-insights";
import { createWound } from "@/lib/wounds";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const yesterday = () => new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

test("Resident 360: Wunden und Ereignisse je Bewohner, kritische Bewohner zuerst", async () => {
  const f = await fixture();
  const anna = await apiContextFor(f, "anna");
  const quiet = await createResident(f, "Olga Ruhig");
  const risky = await createResident(f, "Paul Risiko");
  const woundId = await createWound(anna, {
    residentId: risky,
    woundType: "Dekubitus",
    category: "Kategorie 3",
    bodyLocation: "Ferse links",
    discoveredOn: yesterday(),
    origin: "inhouse",
  });
  // Das Wundformular setzt keinen Schweregrad (nur Grunddaten/Import); hier direkt gesetzt.
  await q(`UPDATE carecore_wounds SET severity = 'critical' WHERE id = $1`, [woundId]);
  await reportEvent(anna, {
    type: "Sturz",
    severity: "attention",
    description: "Neben dem Bett gefunden",
    occurredAt: new Date().toISOString(),
    residentId: risky,
  });

  const data = await residentInsights(anna);
  const byId = new Map(data.residents.map((resident) => [resident.id, resident]));
  const r = byId.get(risky)!;
  const o = byId.get(quiet)!;
  assert.deepEqual(r.wounds, { active: 1, critical: 1 });
  assert.deepEqual(r.events, { total: 1, falls: 1, open: 1 });
  assert.equal(r.tone, "critical");
  assert.deepEqual(o.wounds, { active: 0, critical: 0 });
  assert.deepEqual(o.events, { total: 0, falls: 0, open: 0 });
  assert.equal(o.lastDocumentation, null);
  assert.ok(
    data.residents.findIndex((resident) => resident.id === risky) <
      data.residents.findIndex((resident) => resident.id === quiet),
    "kritische Bewohner stehen oben",
  );
  assert.equal(data.kpis.find((kpi) => kpi.label === "aktive Wunden")?.value, "1");
});
