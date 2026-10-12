import { test } from "node:test";
import assert from "node:assert/strict";
import {
  AiOutputError,
  buildPlanningInput,
  parseAnalysisOutput,
  parsePlanningOutput,
  pseudonyms,
  restoreNames,
  validateAssignments,
  type Finding,
} from "@/lib/roster/ai-core";
import { employee, shift, snapshot } from "./support/roster-fixtures";

let counter = 0;
const newId = () => `new-${++counter}`;
const range = { from: "2026-10-12", to: "2026-10-18" };

test("KI-Ausgabe: ungültiges JSON und falsches Format sind Fehler", () => {
  assert.throws(() => parsePlanningOutput("kein json"), AiOutputError);
  assert.throws(() => parsePlanningOutput(JSON.stringify({ notes: [] })), AiOutputError);
  assert.throws(
    () => parsePlanningOutput(JSON.stringify({ assignments: [{ employeeRef: "E1", date: "2026-10-12" }] })),
    AiOutputError,
  );
  const ok = parsePlanningOutput(
    JSON.stringify({
      assignments: [{ employeeRef: " E1 ", date: "2026-10-12", shiftTypeCode: "f" }],
      notes: [{ date: "nicht-datum", text: "Hinweis" }],
    }),
  );
  assert.deepEqual(ok.assignments, [{ employeeRef: "E1", date: "2026-10-12", shiftTypeCode: "F" }]);
  assert.deepEqual(ok.notes, [{ date: null, text: "Hinweis" }]);
});

test("KI-Zuweisungen: unbekannte Person, Code oder Datum werden verworfen, gültige übernommen", () => {
  const snap = snapshot();
  const refs = pseudonyms(Object.keys(snap.employees));
  const { results, changes } = validateAssignments(
    snap,
    [
      { employeeRef: "E9", date: "2026-10-12", shiftTypeCode: "F" },
      { employeeRef: "E1", date: "2026-10-12", shiftTypeCode: "XX" },
      { employeeRef: "E1", date: "2026-11-02", shiftTypeCode: "F" },
      { employeeRef: "E1", date: "2026-10-12", shiftTypeCode: "F" },
      { employeeRef: "E1", date: "2026-10-12", shiftTypeCode: "S" },
    ],
    refs,
    range,
    newId,
  );
  assert.deepEqual(
    results.map((r) => r.status),
    ["discarded", "discarded", "discarded", "valid", "discarded"],
  );
  assert.match(results[0].reason!, /Unbekannte Person/);
  assert.match(results[1].reason!, /Unbekannter Diensttyp/);
  assert.match(results[2].reason!, /Ungültiges Datum/);
  assert.match(results[4].reason!, /Doppelte Zuweisung/);
  assert.equal(changes.length, 1);
});

test("KI-Zuweisung mit Ruhezeitverstoss wird verworfen (Regel-Engine entscheidet)", () => {
  const snap = snapshot({ shifts: [shift({ id: "s1", employeeId: "e1", shiftTypeId: "S", date: "2026-10-12" })] });
  const refs = pseudonyms(Object.keys(snap.employees));
  const ref = refs.toRef.get("e1")!;
  const { results, changes } = validateAssignments(
    snap,
    [{ employeeRef: ref, date: "2026-10-13", shiftTypeCode: "F" }],
    refs,
    range,
    newId,
  );
  assert.equal(results[0].status, "discarded");
  assert.ok(results[0].violations.some((v) => v.code === "REST_TIME" && v.severity === "BLOCK"));
  assert.equal(changes.length, 0);
});

test("Eingabe an die KI enthält keine Namen und keine Freitexte", () => {
  const snap = snapshot({
    employees: {
      e1: employee("e1"),
      e2: employee("e2", { excludedCategories: ["NIGHT"] }),
    },
    shifts: [
      shift({ id: "u1", employeeId: "e2", shiftTypeId: "U", date: "2026-10-14", notes: "Hochzeit der Tochter" }),
    ],
    timeOff: [
      {
        id: "t1",
        employeeId: "e1",
        unitId: "unit-a",
        startDate: "2026-10-15",
        endDate: "2026-10-15",
        status: "APPROVED",
        priority: "HIGH",
      },
    ],
  });
  const refs = pseudonyms(["e1", "e2"]);
  const text = JSON.stringify(buildPlanningInput(snap, range, refs, { keepExisting: true }));
  for (const forbidden of ["Anna", "Müller", "Max", "Meier", "Hochzeit", "e1", "e2", "Urlaub"])
    assert.ok(!text.includes(forbidden), `„${forbidden}“ darf nicht an die KI gehen`);
  const input = JSON.parse(text) as { personen: Array<{ ref: string; nichtVerfuegbar: string[] }> };
  assert.deepEqual(
    input.personen.map((p) => p.ref),
    ["E1", "E2"],
  );
  // Abwesend und genehmigtes Wunschfrei erscheinen nur als nicht verfügbare Tage.
  assert.deepEqual(input.personen.find((p) => p.ref === refs.toRef.get("e1"))!.nichtVerfuegbar, ["2026-10-15"]);
  assert.deepEqual(input.personen.find((p) => p.ref === refs.toRef.get("e2"))!.nichtVerfuegbar, ["2026-10-14"]);
  // Namen werden erst in der Anzeige wieder eingesetzt.
  assert.equal(restoreNames("E1 und E2", refs, { e1: "Anna Müller", e2: "Max Meier" }), "Anna Müller und Max Meier");
});

test("KI-Analyse: Vorschläge ohne berechneten Befund werden verworfen", () => {
  const findings: Finding[] = [
    {
      id: 1,
      code: "MIN_STAFFING",
      severity: "WARN",
      date: "2026-10-12",
      employeeRef: null,
      shiftTypeCode: "F",
      meta: {},
    },
  ];
  const suggestions = parseAnalysisOutput(
    JSON.stringify({
      suggestions: [
        { priority: "HIGH", title: "Besetzung", reasoning: "Frühdienst fehlt", findingIds: [1], actions: [] },
        { priority: "HIGH", title: "Erfunden", reasoning: "ohne Befund", findingIds: [7], actions: [] },
      ],
    }),
    findings,
  );
  assert.deepEqual(
    suggestions.map((s) => s.title),
    ["Besetzung"],
  );
  assert.throws(() => parseAnalysisOutput("{", findings), AiOutputError);
});
