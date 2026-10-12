import { test } from "node:test";
import assert from "node:assert/strict";
import { compileDictionary, translateText } from "../lib/i18n-core.ts";

const dictionary = compileDictionary({
  strings: { Speichern: "Save", Offen: "Open", Medikamentenplan: "Medication plan" },
  patterns: {
    "Stand {0}": "As of {0}",
    "{0} von {1} Plätzen belegt": "{1} places, {0} occupied",
    "{0} Eintr{1}": "",
    "Status: {0}": "State: {0}",
  },
});

test("Übersetzen: ganzer Text, Leerraum bleibt, Unbekanntes bleibt Deutsch", () => {
  assert.equal(translateText("Speichern", dictionary), "Save");
  assert.equal(translateText("  Speichern ", dictionary), "  Save ");
  assert.equal(translateText("Speichern\n   ", dictionary), "Save\n   ");
  assert.equal(translateText("Speichern und schliessen", dictionary), null, "nur ganze Texte");
  assert.equal(translateText("12", dictionary), null, "ohne Buchstaben nichts");
  assert.equal(translateText("", dictionary), null);
});

test("Übersetzen: Muster mit Platzhaltern, auch in anderer Reihenfolge; Inhalt wird mitübersetzt", () => {
  assert.equal(translateText("Stand 12:30", dictionary), "As of 12:30");
  assert.equal(translateText("3 von 12 Plätzen belegt", dictionary), "12 places, 3 occupied");
  assert.equal(translateText("Status: Offen", dictionary), "State: Open");
  assert.equal(translateText("5 Einträge", dictionary), null, "leere Übersetzung zählt nicht");
});
