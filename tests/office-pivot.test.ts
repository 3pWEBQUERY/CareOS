import { test } from "node:test";
import assert from "node:assert/strict";
import { createZip, readZip } from "@/lib/zip";
import { cellKey } from "@/lib/office/formula";
import { buildXlsx, readXlsx } from "@/lib/office/xlsx";
import { evaluateWorkbook, newSheet, type Sheet, type SheetModel } from "@/lib/office/model";
import { PIVOT_TOTAL, buildPivot, refreshPivotSheet } from "@/lib/office/pivot";
import { PIVOT_MESSAGE, PROTECTED_MESSAGE, cellLocked, protectionBlock } from "@/lib/office/sheet-protection";
import { replaceSheet, setValue } from "@/lib/office/sheet-ops";

// Pflegeleistungen je Wohnbereich und Monat (Minuten), eine Zeile mit Formel, eine leere Zeile, ein leerer Bereich.
function workbook(): SheetModel {
  const data = newSheet("Leistungen");
  const rows = [
    ["Wohnbereich", "Monat", "Minuten"],
    ["Ahorn", "Januar", "120"],
    ["Birke", "Januar", "90"],
    ["Ahorn", "Februar", "60.5"],
    ["", "", ""],
    ["Birke", "Februar", "=10*3"],
    ["", "Februar", "15"],
  ];
  rows.forEach((row, r) => row.forEach((v, c) => v && (data.cells[cellKey(c, r)] = { v })));
  return { kind: "sheet", sheets: [data] };
}

const text = (sheet: Pick<Sheet, "cells">, ref: string) => sheet.cells[ref]?.v.replace(/^'/, "") ?? "";

test("Pivot: Summe je Zeilenfeld mit Gesamtergebnis, leere Zeilen übersprungen, leere Gruppe „(Leer)“", () => {
  const model = workbook();
  const evaluator = evaluateWorkbook(model);
  const built = buildPivot(
    model,
    { source: model.sheets[0].id, range: "A1:C7", rows: 0, cols: null, value: 2, fn: "sum" },
    evaluator.value,
  );
  assert.ok(!("error" in built));
  const sheet = { cells: built.cells };
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((row) => [text(sheet, `A${row}`), text(sheet, `B${row}`)]),
    [
      ["Wohnbereich", "Summe von Minuten"],
      ["Ahorn", "180.5"],
      ["Birke", "120"],
      ["(Leer)", "15"],
      [PIVOT_TOTAL, "315.5"],
    ],
  );
  assert.equal(built.rows, 5);
  assert.equal(sheet.cells.A1.s?.b, true, "Überschrift fett");
  assert.equal(sheet.cells.A1.v, "Wohnbereich", "Beschriftungen als Text");
});

test("Pivot: Zeilen und Spalten, Anzahl und Mittelwert", () => {
  const model = workbook();
  const evaluator = evaluateWorkbook(model);
  const source = model.sheets[0].id;
  const count = buildPivot(model, { source, range: "A1:C7", rows: 0, cols: 1, value: 2, fn: "count" }, evaluator.value);
  assert.ok(!("error" in count));
  const sheet = { cells: count.cells };
  // Spalten alphabetisch: Februar, Januar; dann Gesamtergebnis.
  assert.deepEqual([text(sheet, "A1"), text(sheet, "B1")], ["Anzahl von Minuten", "Monat"]);
  assert.deepEqual(
    [text(sheet, "A2"), text(sheet, "B2"), text(sheet, "C2"), text(sheet, "D2")],
    ["Wohnbereich", "Februar", "Januar", PIVOT_TOTAL],
  );
  const row = (label: string) => {
    const r = [3, 4, 5, 6].find((n) => text(sheet, `A${n}`) === label)!;
    return [text(sheet, `B${r}`), text(sheet, `C${r}`), text(sheet, `D${r}`)];
  };
  assert.deepEqual(row("Ahorn"), ["1", "1", "2"]);
  assert.deepEqual(row("Birke"), ["1", "1", "2"]);
  assert.deepEqual(row(PIVOT_TOTAL), ["3", "2", "5"]);
  assert.equal(sheet.cells.B3.s?.fmt, "integer");

  const average = buildPivot(
    model,
    { source, range: "A1:C7", rows: 1, cols: null, value: 2, fn: "average" },
    evaluator.value,
  );
  assert.ok(!("error" in average));
  const avg = { cells: average.cells };
  assert.equal(text(avg, "B1"), "Mittelwert von Minuten");
  assert.equal(text(avg, "A2"), "Februar");
  assert.equal(text(avg, "B2"), String(Number(((60.5 + 30 + 15) / 3).toPrecision(15))));
  assert.equal(text(avg, "B4"), "63.1");
});

test("Pivot: Fehler bei fehlender Quelle oder Feld ausserhalb; Aktualisieren übernimmt geänderte Daten", () => {
  const model = workbook();
  const evaluator = evaluateWorkbook(model);
  const source = model.sheets[0].id;
  assert.deepEqual(
    buildPivot(model, { source: "weg", range: "A1:C7", rows: 0, cols: null, value: 2, fn: "sum" }, evaluator.value),
    {
      error: "Das Blatt mit den Quelldaten gibt es nicht mehr.",
    },
  );
  assert.deepEqual(
    buildPivot(model, { source, range: "A1:C7", rows: 0, cols: null, value: 5, fn: "sum" }, evaluator.value),
    {
      error: "Ein Feld liegt ausserhalb des Quellbereichs.",
    },
  );
  const pivotSheet: Sheet = {
    ...newSheet("Pivot"),
    pivot: { source, range: "A1:C7", rows: 0, cols: null, value: 2, fn: "max" },
  };
  let next = { ...model, sheets: [...model.sheets, pivotSheet] };
  const first = refreshPivotSheet(next, pivotSheet, evaluateWorkbook(next).value);
  assert.ok(!("error" in first));
  assert.equal(text(first, "A2"), "Ahorn");
  assert.equal(text(first, "B2"), "120");
  next = replaceSheet(next, 0, setValue(next.sheets[0], { col: 1, row: 1 }, "Ahorn"));
  next = replaceSheet(next, 0, setValue(next.sheets[0], { col: 2, row: 1 }, "500"));
  const second = refreshPivotSheet(next, first, evaluateWorkbook(next).value);
  assert.ok(!("error" in second));
  assert.equal(text(second, "B2"), "500");
});

test("Blattschutz: nur Werte in freigegebenen Zellen, Kommentare und Aufheben des Schutzes", () => {
  const sheet = newSheet("Plan");
  sheet.cells.A1 = { v: "Titel", s: { b: true } };
  sheet.cells.B2 = { v: "", s: { unlocked: true } };
  sheet.protected = true;
  const model: SheetModel = { kind: "sheet", sheets: [sheet] };
  const change = (next: Sheet) => protectionBlock(model, { ...model, sheets: [next] });

  assert.equal(cellLocked(sheet, "A1"), true);
  assert.equal(cellLocked(sheet, "B2"), false);
  assert.equal(change(setValue(sheet, { col: 1, row: 1 }, "42")), null, "freigegebene Zelle");
  assert.equal(change(setValue(sheet, { col: 0, row: 0 }, "Neu")), PROTECTED_MESSAGE, "gesperrte Zelle");
  assert.equal(
    change(setValue(sheet, { col: 3, row: 3 }, "x")),
    PROTECTED_MESSAGE,
    "leere Zelle ist ebenfalls gesperrt",
  );
  assert.equal(
    change({ ...sheet, cells: { ...sheet.cells, B2: { v: "", s: { unlocked: true, b: true } } } }),
    PROTECTED_MESSAGE,
    "Format",
  );
  assert.equal(change({ ...sheet, cols: { "0": 200 } }), PROTECTED_MESSAGE, "Spaltenbreite");
  assert.equal(change({ ...sheet, rowCount: 101 }), PROTECTED_MESSAGE, "Zeile einfügen");
  assert.equal(change({ ...sheet, name: "Neuer Name" }), null, "Umbenennen");
  assert.equal(change({ ...sheet, protected: false, cells: {} }), null, "Schutz aufheben");
  assert.equal(protectionBlock(model, { ...model, sheets: [] }), null, "Blatt löschen");

  const pivot: Sheet = {
    ...newSheet("Pivot"),
    pivot: { source: sheet.id, range: "A1:B2", rows: 0, cols: null, value: 1, fn: "sum" },
  };
  const withPivot: SheetModel = { kind: "sheet", sheets: [pivot] };
  assert.equal(
    protectionBlock(withPivot, { ...withPivot, sheets: [setValue(pivot, { col: 0, row: 0 }, "x")] }),
    PIVOT_MESSAGE,
  );
  assert.equal(protectionBlock(withPivot, { ...withPivot, sheets: [{ ...pivot, protected: true }] }), PIVOT_MESSAGE);
  assert.equal(
    protectionBlock(withPivot, { ...withPivot, sheets: [{ ...pivot, cols: { "0": 240 } }] }),
    null,
    "Spaltenbreite",
  );
  assert.equal(
    protectionBlock(withPivot, { ...withPivot, sheets: [{ ...pivot, pivot: { ...pivot.pivot!, fn: "max" } }] }),
    PIVOT_MESSAGE,
  );
});

test("Excel: Blattschutz und freigegebene Zellen werden geschrieben und gelesen", () => {
  const sheet = newSheet("Plan");
  sheet.cells.A1 = { v: "Titel", s: { b: true } };
  sheet.cells.B2 = { v: "5", s: { unlocked: true } };
  sheet.protected = true;
  const open = newSheet("Offen");
  open.cells.A1 = { v: "frei" };
  const bytes = buildXlsx({ kind: "sheet", sheets: [sheet, open] }, { title: "Test", author: "Pflege Team" });
  const files = readZip(bytes);
  assert.match(files.get("xl/worksheets/sheet1.xml")!.toString(), /<sheetProtection sheet="1"/);
  assert.doesNotMatch(files.get("xl/worksheets/sheet2.xml")!.toString(), /sheetProtection/);
  assert.match(files.get("xl/styles.xml")!.toString(), /<protection locked="0"\/>/);
  // Ohne gespeichertes Modell (wie aus Excel): Schutz und Freigabe aus der Datei.
  files.delete("carecore/model.json");
  const foreign = readXlsx(createZip([...files].map(([path, content]) => ({ path, content })))).model;
  assert.equal(foreign.sheets[0].protected, true);
  assert.equal(foreign.sheets[0].cells.B2.s?.unlocked, true);
  assert.equal(foreign.sheets[0].cells.A1.s?.unlocked, undefined);
  assert.equal(foreign.sheets[1].protected, undefined);
});
