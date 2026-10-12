import { test } from "node:test";
import assert from "node:assert/strict";
import { substancesOf, weightLoss } from "../lib/quality-indicators.ts";

const DAY = 86_400_000;

test("Qualitätsindikatoren: Gewichtsverlust gegen 30 bzw. 180 Tage früher", () => {
  const now = Date.UTC(2026, 9, 1);
  assert.equal(weightLoss([]), null);
  assert.equal(weightLoss([{ at: now, kg: 60 }]), null, "ohne Vergleichsgewicht nicht beurteilbar");
  const loss = weightLoss([
    { at: now - 200 * DAY, kg: 70 },
    { at: now - 40 * DAY, kg: 66 },
    { at: now - 10 * DAY, kg: 64 },
    { at: now, kg: 62.4 },
  ]);
  assert.ok(loss);
  assert.equal(Math.round((loss.loss30 ?? 0) * 10) / 10, 5.5, "Vergleich mit dem jüngsten Gewicht vor ≥ 30 Tagen");
  assert.equal(Math.round((loss.loss180 ?? 0) * 10) / 10, 10.9);
  const gain = weightLoss([
    { at: now - 31 * DAY, kg: 60 },
    { at: now, kg: 61 },
  ]);
  assert.ok(gain && (gain.loss30 ?? 0) < 0 && gain.loss180 === null);
});

test("Qualitätsindikatoren: Wirkstoffe aus dem Präparatestamm, Kombinationen getrennt", () => {
  assert.deepEqual(substancesOf("Amlodipin, Valsartan", "Exforge"), ["amlodipin", "valsartan"]);
  assert.deepEqual(substancesOf("Paracetamol + Codein", "Co-Dafalgan"), ["paracetamol", "codein"]);
  assert.deepEqual(substancesOf(null, "Metformin"), ["metformin"], "ohne Angabe zählt das Präparat");
  assert.deepEqual(substancesOf("  ", "Bepanthen"), ["bepanthen"]);
});
