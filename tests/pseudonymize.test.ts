import { test } from "node:test";
import assert from "node:assert/strict";
import { pseudonymize } from "@/lib/pseudonymize";

test("Pseudonymisierung: Namen werden zu Platzhaltern und danach wieder eingesetzt", () => {
  const names = ["Erna Muster", "Muster Erna", "Erna", "Muster", "Jo", "Hans Beispiel", "Hans", "Beispiel"];
  const input = "Frau Muster hat gut gegessen, erna war zufrieden. Hans Beispiel hat geholfen.";
  const result = pseudonymize(input, names);
  // Längere Namen zuerst: „Hans Beispiel“ wird als Ganzes ersetzt.
  assert.equal(result.text, "Frau [Person 2] hat gut gegessen, [Person 3] war zufrieden. [Person 1] hat geholfen.");
  assert.equal(result.count, 3);
  assert.equal(result.restore(result.text), input);
  assert.equal(
    result.restore("[Person 3] wirkte zufrieden. [Person 9] bleibt."),
    "erna wirkte zufrieden. [Person 9] bleibt.",
  );
  // Teile anderer Wörter und zu kurze Namen bleiben unverändert; derselbe Name erhält denselben Platzhalter.
  assert.equal(
    pseudonymize("Musterung bei Jo; Erna und ERNA.", names).text,
    "Musterung bei Jo; [Person 1] und [Person 1].",
  );
  // Sonderzeichen in Namen werden nicht als Muster gelesen.
  assert.equal(
    pseudonymize("Herr O'Neil (Zimmer 3), Oxneil", ["O'Neil", "O.Neil"]).text,
    "Herr [Person 1] (Zimmer 3), Oxneil",
  );
});
