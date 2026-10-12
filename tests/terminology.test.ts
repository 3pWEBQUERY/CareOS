import { test } from "node:test";
import assert from "node:assert/strict";
import { TERMINOLOGIES, countOf, navigationLabel, resolveTerminology, termsFor } from "../lib/terminology.ts";
import { moduleLabel } from "../app/components/navigation.ts";

test("Terminologie: unbekannte Werte fallen auf „Bewohner“ zurück", () => {
  assert.equal(resolveTerminology("patient"), "patient");
  assert.equal(resolveTerminology("kunde"), "resident");
  assert.equal(resolveTerminology(null), "resident");
  assert.equal(termsFor(undefined), TERMINOLOGIES.resident);
});

test("Terminologie: Einzahl und Mehrzahl je Bezeichnung", () => {
  assert.equal(countOf(1, TERMINOLOGIES.resident), "1 Bewohner");
  assert.equal(countOf(3, TERMINOLOGIES.resident), "3 Bewohner");
  assert.equal(countOf(1, TERMINOLOGIES.patient), "1 Patient");
  assert.equal(countOf(3, TERMINOLOGIES.patient), "3 Patienten");
  assert.equal(countOf(2, TERMINOLOGIES.client), "2 Klienten");
  assert.equal(`${TERMINOLOGIES.client.prefix}akte`, "Klientenakte");
});

test("Terminologie: Navigation zeigt die Bezeichnung, der Schlüssel bleibt gleich", () => {
  assert.equal(navigationLabel("Bewohner & Pflege", TERMINOLOGIES.patient), "Patienten & Pflege");
  assert.equal(navigationLabel("Kennzahlen Bewohner", TERMINOLOGIES.client), "Kennzahlen Klienten");
  assert.equal(navigationLabel("Bewohner", TERMINOLOGIES.resident), "Bewohner");
  assert.equal(navigationLabel("Medikation", TERMINOLOGIES.patient), "Medikation");
  assert.equal(
    moduleLabel("quality", "Kennzahlen Bewohner", TERMINOLOGIES.patient),
    "Qualität & Kennzahlen · Kennzahlen Patienten",
  );
  assert.equal(moduleLabel("quality", "Kennzahlen Bewohner"), "Qualität & Kennzahlen · Kennzahlen Bewohner");
});
