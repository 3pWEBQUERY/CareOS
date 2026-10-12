import { test } from "node:test";
import assert from "node:assert/strict";
import { createZip, readZip } from "@/lib/zip";
import { toExcelFormula } from "@/lib/office/formula";
import { cleanModel, evaluateWorkbook, nameProblem, newSheet, type SheetModel } from "@/lib/office/model";
import { renameSheet } from "@/lib/office/sheet-ops";
import { barSize, ruleStyler, scaleColor } from "@/lib/office/sheet-features";
import { buildXlsx, readXlsx } from "@/lib/office/xlsx";
import { findAll, parseXml, textOf } from "@/lib/office/xml";

const meta = { title: "Test", author: "Pflege Team" };

// Wie eine Datei aus Excel: ohne das eingebettete CareOS-Modell.
function foreign(bytes: Buffer) {
  const files = readZip(bytes);
  files.delete("carecore/model.json");
  return createZip([...files].map(([path, content]) => ({ path, content })));
}
const xml = (bytes: Buffer, part: string) => parseXml(readZip(bytes).get(part)!.toString("utf8"));

function workbook(): SheetModel {
  const sheet = newSheet("Belegung");
  sheet.cells.A1 = { v: "Wohnbereich" };
  sheet.cells.B1 = { v: "Plätze" };
  ["Ahorn", "Linde", "Eiche"].forEach((name, index) => {
    sheet.cells[`A${index + 2}`] = { v: name };
  });
  sheet.cells.B2 = { v: "24" };
  sheet.cells.B3 = { v: "18" };
  sheet.cells.B4 = { v: "30" };
  sheet.cells.D1 = { v: "=SUMME(Plätze)" };
  sheet.cells.D2 = { v: "=MAX(Plätze)-Erster" };
  sheet.cells.D3 = { v: "=LET(Plätze;5;Plätze*2)" };
  sheet.rules = [
    {
      id: "s",
      range: "B2:B4",
      op: "scale",
      value: "",
      value2: "",
      style: {},
      colors: ["#f8696b", "#ffeb84", "#63be7b"],
    },
    { id: "b", range: "B2:B4", op: "bar", value: "", value2: "", style: {}, colors: ["#638ec6"] },
  ];
  sheet.charts = [
    {
      id: "c",
      type: "column",
      range: "A1:B4",
      title: "Plätze",
      x: 300,
      y: 20,
      w: 480,
      h: 300,
      xTitle: "Wohnbereich",
      yTitle: "Anzahl",
      labels: true,
    },
  ];
  sheet.print = {
    orientation: "portrait",
    fit: true,
    gridlines: false,
    area: "A1:B4",
    header: "Haus Ahorn & Linde",
    footer: "Stand Oktober",
    pageNumbers: true,
  };
  return {
    kind: "sheet",
    sheets: [sheet],
    names: [
      { name: "Plätze", sheet: "Belegung", range: "B2:B4" },
      { name: "Erster", sheet: "Belegung", range: "B2" },
    ],
  };
}

test("Namen: benannte Bereiche in Formeln (Bereich, einzelne Zelle, LET hat Vorrang)", () => {
  const result = evaluateWorkbook(workbook());
  assert.equal(result.value(0, "D1"), 72);
  assert.equal(result.value(0, "D2"), 6);
  assert.equal(result.value(0, "D3"), 10);
  const unknown = evaluateWorkbook({ kind: "sheet", sheets: [{ ...newSheet("A"), cells: { A1: { v: "=Fehlt+1" } } }] });
  assert.deepEqual(unknown.value(0, "A1"), { error: "#NAME?" });
});

test("Namen: Prüfung, Umbenennen des Blatts und Excel-Formeln ohne „_xlpm.“", () => {
  assert.equal(nameProblem("Plätze"), null);
  assert.equal(nameProblem("_Summe.Total"), null);
  assert.match(nameProblem("B2") ?? "", /Zellbezug/);
  assert.match(nameProblem("Z1S1") ?? "", /Zellbezug/);
  assert.match(nameProblem("2Plätze") ?? "", /Buchstaben/);
  assert.match(nameProblem("mit Leerzeichen") ?? "", /Buchstaben/);
  assert.match(nameProblem("Wahr") ?? "", /reserviert/);
  const renamed = renameSheet(workbook(), 0, "Plätze 2026");
  assert.deepEqual(
    renamed.names?.map((entry) => entry.sheet),
    ["Plätze 2026", "Plätze 2026"],
  );
  assert.equal(toExcelFormula("SUMME(Plätze)+x", new Set(["PLÄTZE"])), "SUM(Plätze)+_xlpm.x");
  // Ungültige oder doppelte Namen und Namen auf fehlenden Blättern fallen weg.
  const cleaned = cleanModel("sheet", {
    sheets: [newSheet("A")],
    names: [
      { name: "Gut", sheet: "A", range: "a1:b2" },
      { name: "gut", sheet: "A", range: "C1" },
      { name: "A1", sheet: "A", range: "C1" },
      { name: "Fremd", sheet: "B", range: "C1" },
    ],
  }) as SheetModel;
  assert.deepEqual(cleaned.names, [{ name: "Gut", sheet: "A", range: "A1:B2" }]);
});

test("Farbskala und Datenbalken: Farben über den Median und Länge wie in Excel", () => {
  assert.equal(scaleColor(["#000000", "#ffffff"], 5, 0, 5, 10), "#808080");
  assert.equal(scaleColor(["#ff0000", "#ffff00", "#00ff00"], 18, 18, 24, 30), "#ff0000");
  assert.equal(scaleColor(["#ff0000", "#ffff00", "#00ff00"], 24, 18, 24, 30), "#ffff00");
  assert.equal(scaleColor(["#ff0000", "#ffff00", "#00ff00"], 30, 18, 24, 30), "#00ff00");
  assert.equal(barSize(18, 18, 30), 0.1);
  assert.equal(Math.round(barSize(30, 18, 30) * 1000) / 1000, 0.9);
  const model = workbook();
  const values = evaluateWorkbook(model);
  const look = ruleStyler(model.sheets[0], (col, row) => values.value(0, `${"ABCD"[col]}${row + 1}`));
  assert.equal(look(1, 2)?.fill, "#f8696b");
  assert.equal(look(1, 1)?.fill, "#ffeb84");
  assert.equal(look(1, 3)?.fill, "#63be7b");
  assert.equal(look(1, 3)?.bar?.color, "#638ec6");
  assert.equal(Math.round((look(1, 3)?.bar?.size ?? 0) * 1000) / 1000, 0.9);
  assert.equal(look(0, 1), undefined);
});

test("Excel: Namen, Druckbereich, Kopf-/Fusszeile, Farbskala, Datenbalken und Achsentitel in der Datei", () => {
  const model = workbook();
  const bytes = buildXlsx(model, meta);
  const files = readZip(bytes);
  const book = xml(bytes, "xl/workbook.xml");
  const names = findAll(book, "definedName").map((node) => [node.attrs.name, textOf(node)]);
  assert.deepEqual(names, [
    ["Plätze", "Belegung!$B$2:$B$4"],
    ["Erster", "Belegung!$B$2"],
    ["_xlnm.Print_Area", "Belegung!$A$1:$B$4"],
  ]);
  const sheet = xml(bytes, "xl/worksheets/sheet1.xml");
  const formula = (ref: string) =>
    textOf(
      findAll(
        findAll(sheet, "c").find((cell) => cell.attrs.r === ref)!,
        "f",
      )[0],
    );
  assert.equal(formula("D1"), "SUM(Plätze)");
  assert.equal(formula("D3"), "_xlfn.LET(_xlpm.Plätze,5,_xlpm.Plätze*2)");
  assert.equal(textOf(findAll(sheet, "oddHeader")[0]), "&CHaus Ahorn && Linde");
  // In der Datei als gültiges XML (Excel-Codes mit maskiertem „&“).
  assert.match(
    files.get("xl/worksheets/sheet1.xml")!.toString(),
    /<oddHeader>&amp;CHaus Ahorn &amp;&amp; Linde<\/oddHeader>/,
  );
  assert.equal(textOf(findAll(sheet, "oddFooter")[0]), "&LStand Oktober&RSeite &P von &N");
  const rules = findAll(sheet, "cfRule").map((rule) => rule.attrs.type);
  assert.deepEqual(rules, ["colorScale", "dataBar"]);
  assert.deepEqual(
    findAll(findAll(sheet, "colorScale")[0], "color").map((node) => node.attrs.rgb),
    ["FFF8696B", "FFFFEB84", "FF63BE7B"],
  );
  const chart = files.get("xl/charts/chart1.xml")!.toString();
  assert.match(chart, /<c:catAx>.*<c:title>.*Wohnbereich.*<\/c:catAx>/);
  assert.match(chart, /<c:valAx>.*<c:title>.*Anzahl.*<\/c:valAx>/);
  assert.match(chart, /<c:dLbls>.*<c:showVal val="1"\/>/);
  assert.deepEqual(readXlsx(bytes).model, cleanModel("sheet", model));
});

test("Excel: fremde Datei mit Namen, Druckbereich, Kopf-/Fusszeile, Farbskala, Datenbalken und Achsentiteln", () => {
  const { model, imported } = readXlsx(foreign(buildXlsx(workbook(), meta)));
  assert.equal(imported, true);
  assert.deepEqual(model.names, [
    { name: "Plätze", sheet: "Belegung", range: "B2:B4" },
    { name: "Erster", sheet: "Belegung", range: "B2" },
  ]);
  const [sheet] = model.sheets;
  assert.equal(sheet.cells.D1.v, "=SUMME(Plätze)");
  assert.equal(sheet.cells.D3.v, "=LET(Plätze;5;Plätze*2)");
  assert.equal(evaluateWorkbook(model).value(0, "D1"), 72);
  assert.equal(sheet.print.area, "A1:B4");
  assert.equal(sheet.print.header, "Haus Ahorn & Linde");
  assert.equal(sheet.print.footer, "Stand Oktober");
  assert.equal(sheet.print.pageNumbers, true);
  assert.deepEqual(
    sheet.rules.map((rule) => [rule.op, rule.colors]),
    [
      ["scale", ["#f8696b", "#ffeb84", "#63be7b"]],
      ["bar", ["#638ec6"]],
    ],
  );
  const [chart] = sheet.charts;
  assert.deepEqual([chart.title, chart.xTitle, chart.yTitle, chart.labels], ["Plätze", "Wohnbereich", "Anzahl", true]);
});
