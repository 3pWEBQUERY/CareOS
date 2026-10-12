import { test } from "node:test";
import assert from "node:assert/strict";
import { findInteractions, mentions, type InteractionRule } from "@/lib/medication-interactions-shared";

const rule = (substanceA: string, substanceB: string, severity: InteractionRule["severity"]): InteractionRule => ({
  id: `${substanceA}-${substanceB}`,
  substanceA,
  substanceB,
  severity,
  description: "Beschreibung",
  recommendation: "",
  source: "Apotheke",
  updatedAt: "",
  updatedBy: null,
});

test("Wechselwirkungen: Wirkstoff als ganzes Wort, ohne Gross-/Kleinschreibung", () => {
  assert.equal(mentions("Marcoumar 3 mg phenprocoumon", "Phenprocoumon"), true);
  assert.equal(mentions("Aspirin Cardio", "aspirin"), true);
  assert.equal(mentions("Aspirinol", "Aspirin"), false, "kein Treffer mitten im Wort");
  assert.equal(mentions("Ibuprofen", "   "), false);
  assert.equal(mentions("L-Thyroxin (Levothyroxin)", "Levothyroxin"), true);
  assert.equal(mentions("Präparat a+b", "a+b"), true, "Sonderzeichen gelten wörtlich");
});

test("Wechselwirkungen: Paare aus zwei Verordnungen, beide Richtungen, nach Schweregrad sortiert", () => {
  const orders = [
    { id: "1", name: "Marcoumar 3 mg", text: "Marcoumar phenprocoumon" },
    { id: "2", name: "Ibuprofen 400 mg", text: "Ibuprofen ibuprofen" },
    { id: "3", name: "Omeprazol 20 mg", text: "Omeprazol omeprazol" },
  ];
  const findings = findInteractions(orders, [
    rule("Omeprazol", "Phenprocoumon", "minor"),
    rule("Ibuprofen", "Phenprocoumon", "major"),
    rule("Ibuprofen", "Paracetamol", "moderate"),
  ]);
  assert.deepEqual(
    findings.map((f) => [f.severity, f.orderA.name, f.orderB.name]),
    [
      ["major", "Ibuprofen 400 mg", "Marcoumar 3 mg"],
      ["minor", "Omeprazol 20 mg", "Marcoumar 3 mg"],
    ],
  );
  assert.equal(findings.length, 2, "jede Kombination nur einmal, keine ohne zweites Präparat");
  assert.deepEqual(
    findInteractions([orders[0]], [rule("Marcoumar", "Phenprocoumon", "major")]),
    [],
    "nie dieselbe Verordnung mit sich selbst",
  );
});
