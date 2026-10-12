import { test } from "node:test";
import assert from "node:assert/strict";
import {
  adjustForInsertDelete,
  dateSerial,
  evaluate,
  formulaProblem,
  fromExcelFormula,
  parseFormula,
  parseInput,
  renameSheetReferences,
  shiftFormula,
  toExcelFormula,
  type Value,
} from "@/lib/office/formula";
import { evaluateWorkbook, formatValue, newSheet, type SheetModel } from "@/lib/office/model";

// Kleine Arbeitsmappe aus Zellwerten: { Tabelle1: { A1: "5", A2: "=A1*2" } }.
function book(sheets: Record<string, Record<string, string>>): SheetModel {
  return {
    kind: "sheet",
    sheets: Object.entries(sheets).map(([name, cells]) => {
      const sheet = newSheet(name);
      for (const [key, v] of Object.entries(cells)) sheet.cells[key] = { v };
      return sheet;
    }),
  };
}
const run = (formula: string, cells: Record<string, string> = {}): Value => {
  const model = book({ Tabelle1: { ...cells, Z99: `=${formula}` } });
  return evaluateWorkbook(model, { today: () => dateSerial(2026, 10, 4) }).value(0, "Z99");
};

test("Formeln: Rechenregeln, Prozent, Text und Vergleiche wie in Excel", () => {
  assert.equal(run("1+2*3"), 7);
  assert.equal(run("(1+2)*3"), 9);
  assert.equal(run("2^3^2"), 512);
  assert.equal(run("-2^2"), 4);
  assert.equal(run("10%*50"), 5);
  assert.equal(run('"Zimmer "&12'), "Zimmer 12");
  assert.equal(run('"abc"="ABC"'), true);
  assert.equal(run("3<>3"), false);
  assert.equal(run("A1+A2", { A1: "4", A2: "" }), 4);
  assert.deepEqual(run("1/0"), { error: "#DIV/0!" });
  assert.deepEqual(run('"x"+1'), { error: "#VALUE!" });
  assert.deepEqual(run("GIBTESNICHT(1)"), { error: "#NAME?" });
});

test("Formeln: Funktionen mit deutschen und englischen Namen, Bereiche und Bedingungen", () => {
  const cells = { A1: "4", A2: "6", A3: "Text", A4: "10", B1: "Ja", B2: "Nein", B3: "Ja", B4: "Ja" };
  assert.equal(run("SUMME(A1:A4)", cells), 20);
  assert.equal(run("SUMME(A:A)", cells), 20);
  assert.equal(run("SUM(A1:A4)", cells), 20);
  assert.equal(run("MITTELWERT(A1:A4)", cells), 20 / 3);
  assert.equal(run("ANZAHL(A1:A4)", cells), 3);
  assert.equal(run("ANZAHL2(A1:A4)", cells), 4);
  assert.equal(run('ZÄHLENWENN(B1:B4;"Ja")', cells), 3);
  assert.equal(run('SUMMEWENN(B1:B4;"Ja";A1:A4)', cells), 14);
  assert.equal(run('ZÄHLENWENN(A1:A4;">5")', cells), 2);
  assert.equal(run("MAX(A1:A4;12)", cells), 12);
  assert.equal(run("RUNDEN(2.345;2)", cells), 2.35);
  assert.equal(run("ABRUNDEN(2.349;2)"), 2.34);
  assert.equal(run("REST(-3;4)"), 1);
  assert.equal(run('WENN(A1>3;"hoch";"tief")', cells), "hoch");
  // Nur der gewählte Zweig wird gerechnet.
  assert.equal(run("WENN(WAHR;1;1/0)"), 1);
  assert.equal(run("WENNFEHLER(1/0;0)"), 0);
  assert.equal(run('UND(A1>1;B1="Ja")', cells), true);
  assert.equal(run('VERKETTEN("A";"-";1)'), "A-1");
  assert.equal(run('LINKS("Pflege";3)&RECHTS("Haus";2)'), "Pflus");
  assert.equal(run('TEIL("CareOS";5;2)'), "OS");
  assert.equal(run('GROSS("äb")'), "ÄB");
  assert.equal(run("MEDIAN(1;9;3)"), 3);
});

test("Formeln: Datum, SVERWEIS und Bezüge auf andere Blätter", () => {
  assert.equal(run("HEUTE()"), dateSerial(2026, 10, 4));
  assert.equal(run("JAHR(DATUM(2026;12;24))"), 2026);
  assert.equal(run("TAG(DATUM(2026;2;30))"), 2);
  const table = { A1: "1", B1: "eins", A2: "2", B2: "zwei", A3: "5", B3: "fünf" };
  assert.equal(run("SVERWEIS(2;A1:B3;2;FALSCH)", table), "zwei");
  assert.equal(run("SVERWEIS(4;A1:B3;2)", table), "zwei");
  assert.deepEqual(run("SVERWEIS(9;A1:B3;2;FALSCH)", table), { error: "#N/A" });
  const model = book({
    Lager: { A1: "3" },
    "Mai 2026": { A1: "4" },
    Total: { A1: "=Lager!A1+'Mai 2026'!A1", A2: "=Fehlt!A1" },
  });
  const evaluator = evaluateWorkbook(model);
  assert.equal(evaluator.value(2, "A1"), 7);
  assert.deepEqual(evaluator.value(2, "A2"), { error: "#REF!" });
});

test("Formeln: Zirkelbezüge und ungültige Formeln werden erkannt", () => {
  const model = book({ Tabelle1: { A1: "=B1+1", B1: "=A1+1", C1: "=SUMME(1;" } });
  const evaluator = evaluateWorkbook(model);
  assert.deepEqual(evaluator.value(0, "A1"), { error: "#CYCLE!" });
  assert.deepEqual(evaluator.value(0, "C1"), { error: "#NAME?" });
  assert.ok(formulaProblem("SUMME(1;"));
  assert.equal(formulaProblem("SUMME(A1:A3)"), null);
  assert.throws(() => parseFormula("1+"));
  assert.equal(evaluate(parseFormula("1+1"), { cell: () => null, hasSheet: () => true }), 2);
});

test("Eingaben: Schweizer Zahlen, Prozent, Datum, Uhrzeit und erzwungener Text", () => {
  assert.deepEqual(parseInput("1'250.50"), { type: "number", value: 1250.5 });
  assert.deepEqual(parseInput("12,5"), { type: "number", value: 12.5 });
  assert.deepEqual(parseInput("15%"), { type: "number", value: 0.15, format: "percent" });
  assert.deepEqual(parseInput("4.10.2026"), { type: "number", value: dateSerial(2026, 10, 4), format: "date" });
  assert.deepEqual(parseInput("31.02.2026"), { type: "text", value: "31.02.2026" });
  assert.deepEqual(parseInput("07:30"), { type: "number", value: 0.3125, format: "time" });
  assert.deepEqual(parseInput("'007"), { type: "text", value: "007" });
  assert.deepEqual(parseInput("WAHR"), { type: "boolean", value: true });
  assert.deepEqual(parseInput("=A1"), { type: "formula", formula: "A1" });
});

test("Anzeige: Zahlenformate mit Schweizer Schreibweise", () => {
  assert.equal(formatValue(1234.5, { fmt: "chf" }), "CHF 1’234.50");
  assert.equal(formatValue(0.125, { fmt: "percent", dec: 1 }), "12.5%");
  assert.equal(formatValue(dateSerial(2026, 10, 4), { fmt: "date" }), "04.10.2026");
  assert.equal(formatValue(0.3125, { fmt: "time" }), "07:30");
  assert.equal(formatValue(true), "WAHR");
  assert.equal(formatValue({ error: "#VALUE!" }), "#WERT!");
  assert.equal(formatValue(0.1 + 0.2), "0.3");
});

test("Excel-Schreibweise: deutsche Namen und Semikolon hin und zurück", () => {
  assert.equal(toExcelFormula('WENN(SUMME(A1:A3)>10;"hoch";"tief")'), 'IF(SUM(A1:A3)>10,"hoch","tief")');
  assert.equal(toExcelFormula('ZÄHLENWENN(B:B;"Ja")'), 'COUNTIF(B:B,"Ja")');
  assert.equal(toExcelFormula("UND(WAHR;FALSCH)"), "AND(TRUE,FALSE)");
  assert.equal(toExcelFormula('VERKETTEN(A1;"; ")'), '_xlfn.CONCAT(A1,"; ")');
  assert.equal(fromExcelFormula('IF(SUM(A1:A3)>10,"hoch","tief")'), 'WENN(SUMME(A1:A3)>10;"hoch";"tief")');
  assert.equal(fromExcelFormula("_xlfn.CONCAT(A1,B1)"), "VERKETTEN(A1;B1)");
});

test("Bezüge: verschieben, Zeilen einfügen und löschen, Blatt umbenennen", () => {
  assert.equal(shiftFormula("A1+$B$2+C$3+'Mai 2026'!D4", 1, 2), "B3+$B$2+D$3+'Mai 2026'!E6");
  assert.equal(shiftFormula('"A1"&A1', 0, 1), '"A1"&A2');
  assert.equal(shiftFormula("A1", -1, 0), "#BEZUG!");
  const same = (sheet: string | undefined) => sheet === undefined;
  assert.equal(adjustForInsertDelete("SUMME(A1:A10)+A12", "row", 4, 2, same), "SUMME(A1:A12)+A14");
  assert.equal(adjustForInsertDelete("SUMME(A1:A10)+A12", "row", 2, -3, same), "SUMME(A1:A7)+A9");
  assert.equal(adjustForInsertDelete("A3+1", "row", 2, -3, same), "#BEZUG!+1");
  assert.equal(
    adjustForInsertDelete("Lager!A3+A3", "row", 0, 1, (sheet) => sheet === "Lager"),
    "Lager!A4+A3",
  );
  assert.equal(adjustForInsertDelete("SUMME(B1:D1)", "col", 2, -1, same), "SUMME(B1:C1)");
  assert.equal(
    renameSheetReferences("Lager!A1+lager!B2+A1", "Lager", "Vorrat 2026"),
    "'Vorrat 2026'!A1+'Vorrat 2026'!B2+A1",
  );
});
