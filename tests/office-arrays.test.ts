import { test } from "node:test";
import assert from "node:assert/strict";
import { dateSerial, fromExcelFormula, toExcelFormula, type Value } from "@/lib/office/formula";
import { evaluateWorkbook, newSheet, type SheetModel } from "@/lib/office/model";

function book(cells: Record<string, string>, extra: (model: SheetModel) => void = () => {}): SheetModel {
  const sheet = newSheet("Tabelle1");
  for (const [key, v] of Object.entries(cells)) sheet.cells[key] = { v };
  const model: SheetModel = { kind: "sheet", sheets: [sheet] };
  extra(model);
  return model;
}
const evaluator = (cells: Record<string, string>, extra?: (model: SheetModel) => void) =>
  evaluateWorkbook(book(cells, extra), { today: () => dateSerial(2026, 10, 5) });
const run = (formula: string, cells: Record<string, string> = {}): Value =>
  evaluator({ ...cells, Z99: `=${formula}` }).value(0, "Z99");
const area = (cells: Record<string, string>, keys: string[]) => {
  const book = evaluator(cells);
  return keys.map((key) => book.value(0, key));
};

const team = {
  A1: "Name",
  B1: "Bereich",
  C1: "Stunden",
  A2: "Cem",
  B2: "Pflege",
  C2: "4",
  A3: "Anna",
  B3: "Küche",
  C3: "8",
  A4: "Ben",
  B4: "Pflege",
  C4: "6",
};

test("Überlauf: FILTERN, SORTIEREN, EINDEUTIG, SEQUENZ füllen die Nachbarzellen", () => {
  assert.deepEqual(area({ ...team, E1: '=FILTERN(A2:A4;B2:B4="Pflege")' }, ["E1", "E2", "E3"]), ["Cem", "Ben", null]);
  assert.deepEqual(area({ ...team, E1: "=SORTIEREN(A2:C4;3;-1)" }, ["E1", "F1", "G1", "E3", "G3"]), [
    "Anna",
    "Küche",
    8,
    "Cem",
    4,
  ]);
  assert.deepEqual(area({ ...team, E1: "=EINDEUTIG(B2:B4)" }, ["E1", "E2", "E3"]), ["Pflege", "Küche", null]);
  assert.deepEqual(area({ E1: "=SEQUENZ(2;3;10;5)" }, ["E1", "F1", "G1", "E2", "G2"]), [10, 15, 20, 25, 35]);
  assert.deepEqual(area({ ...team, E1: "=MTRANS(A1:C1)" }, ["E1", "E2", "E3"]), ["Name", "Bereich", "Stunden"]);
  assert.deepEqual(area({ ...team, E1: "=SORTIERENNACH(A2:A4;C2:C4)" }, ["E1", "E2", "E3"]), ["Cem", "Ben", "Anna"]);
  assert.deepEqual(area({ ...team, E1: "=C2:C4*2" }, ["E1", "E2", "E3"]), [8, 16, 12]);
  // Weiterrechnen mit übergelaufenen Werten.
  assert.deepEqual(area({ ...team, E1: "=C2:C4*2", F1: "=SUMME(E1:E3)" }, ["F1"]), [36]);
});

test("Überlauf: belegte Zielzellen ergeben #ÜBERLAUF!, leere Ergebnisse #KALK!", () => {
  assert.deepEqual(area({ ...team, E1: "=SEQUENZ(3)", E2: "x" }, ["E1", "E3"]), [{ error: "#SPILL!" }, null]);
  assert.deepEqual(run('FILTERN(A2:A4;B2:B4="Technik")', team), { error: "#CALC!" });
  assert.equal(run('FILTERN(A2:A4;B2:B4="Technik";"keiner")', team), "keiner");
});

test("Bereiche: ZEILEN/SPALTEN, ÜBERNEHMEN, WEGLASSEN, STAPELN, TEXTTEILEN", () => {
  assert.equal(run('ZEILEN(FILTERN(A2:A4;B2:B4="Pflege"))', team), 2);
  assert.deepEqual(area({ ...team, E1: "=ÜBERNEHMEN(A2:C4;-1;1)" }, ["E1", "E2"]), ["Ben", null]);
  assert.deepEqual(area({ ...team, E1: "=WEGLASSEN(A1:A4;1)" }, ["E1", "E3"]), ["Cem", "Ben"]);
  assert.deepEqual(area({ ...team, E1: "=VSTAPELN(A1:B1;C1)" }, ["E1", "F1", "E2", "F2"]), [
    "Name",
    "Bereich",
    "Stunden",
    { error: "#N/A" },
  ]);
  assert.deepEqual(area({ E1: '=TEXTTEILEN("a,b;c,d";",";";")' }, ["E1", "F1", "E2", "F2"]), ["a", "b", "c", "d"]);
  assert.deepEqual(area({ ...team, E1: "=WAHLSPALTE(A1:C2;3;1)" }, ["E1", "F1", "E2"]), ["Stunden", "Name", 4]);
  assert.deepEqual(area({ ...team, E1: "=ZUSPALTE(A1:B2)" }, ["E1", "E2", "E3", "E4"]), [
    "Name",
    "Bereich",
    "Cem",
    "Pflege",
  ]);
  assert.equal(run("XVERGLEICH(6;C2:C4)", team), 3);
  assert.equal(run('SUMME(WENN(B2:B4="Pflege";C2:C4;0))', team), 10);
  assert.equal(run("SUMME(RUNDEN(C2:C4/3;0))", team), 6);
});

test("INDIREKT, BEREICH.VERSCHIEBEN, LET, TEILERGEBNIS, ISTFORMEL, FORMELTEXT", () => {
  assert.equal(run('INDIREKT("C"&3)', team), 8);
  assert.equal(run('SUMME(INDIREKT("C2:C4"))', team), 18);
  assert.equal(run('INDIREKT("Z3S3";FALSCH)', team), 8);
  assert.deepEqual(run('INDIREKT("Gibtsnicht!A1")', team), { error: "#REF!" });
  assert.equal(run("SUMME(BEREICH.VERSCHIEBEN(A1;1;2;3;1))", team), 18);
  assert.equal(run("BEREICH.VERSCHIEBEN(C2;2;0)", team), 6);
  assert.equal(run("ZEILE(BEREICH.VERSCHIEBEN(A1;3;0))", team), 4);
  assert.equal(run("LET(x;C2;y;C3;x*y)", team), 32);
  assert.equal(run("TEILERGEBNIS(9;C2:C4)", team), 18);
  assert.equal(run("ISTFORMEL(Z99)", team), true);
  assert.equal(run("FORMELTEXT(Z99)", team), "=FORMELTEXT(Z99)");
  const hidden = evaluator({ ...team, Z1: "=TEILERGEBNIS(109;C2:C4)", Z2: "=TEILERGEBNIS(9;C2:C4)" }, (model) => {
    model.sheets[0].hiddenRows = [2];
  });
  assert.equal(hidden.value(0, "Z1"), 10);
  assert.equal(hidden.value(0, "Z2"), 18);
  const filteredBook = evaluator({ ...team, Z1: "=TEILERGEBNIS(9;C2:C4)" }, (model) => {
    model.sheets[0].filter = { range: "A1:C4", hidden: { "1": ["Küche"] } };
  });
  assert.equal(filteredBook.value(0, "Z1"), 10);
});

test("Finanzen, Statistik, Mathematik, Text und Datum", () => {
  const near = (value: Value, expected: number, digits = 6) =>
    assert.equal(Number((value as number).toFixed(digits)), Number(expected.toFixed(digits)));
  near(run("RMZ(5%/12;60;20000)"), -377.424673);
  near(run("ZW(4%;10;-1000)"), 12006.107123);
  near(run("BW(5%;10;-1000)"), 7721.734929);
  near(run("ZZR(1%;-100;1000)"), 10.588644);
  near(run("ZINS(60;-377.424673;20000)*12"), 0.05);
  near(run("ZINSZ(5%/12;1;60;20000)"), -83.333333);
  near(run("KAPZ(5%/12;1;60;20000)"), -294.09134);
  near(run("NBW(10%;-1000;300;400;500)"), -19.124377);
  near(run("IKV(A1:A4)", { A1: "-1000", A2: "300", A3: "400", A4: "500" }), 0.088963);
  const data = { A1: "1", A2: "2", A3: "3", A4: "4", B1: "2", B2: "4", B3: "5", B4: "8" };
  assert.equal(run("QUANTIL.INKL(A1:A4;0.5)", data), 2.5);
  assert.equal(run("QUARTILE.INKL(A1:A4;1)", data), 1.75);
  near(run("KORREL(A1:A4;B1:B4)", data), 0.981156);
  near(run("STEIGUNG(B1:B4;A1:A4)", data), 1.9);
  near(run("ACHSENABSCHNITT(B1:B4;A1:A4)", data), 0.0);
  near(run("PROGNOSE.LINEAR(5;B1:B4;A1:A4)", data), 9.5);
  near(run("GEOMITTEL(A1:A4)", data), 2.213364);
  assert.equal(run("RANG.MITTELW(2;B1:B4)", { B1: "2", B2: "2", B3: "5" }), 2.5);
  near(run("NORM.VERT(1;0;1;WAHR)"), 0.841345, 6);
  assert.equal(run("FAKULTÄT(5)"), 120);
  assert.equal(run("KOMBINATIONEN(6;2)"), 15);
  assert.equal(run("RÖMISCH(2026)"), "MMXXVI");
  assert.equal(run('ARABISCH("MMXXVI")'), 2026);
  assert.equal(run("DEZINBIN(10;8)"), "00001010");
  assert.equal(run('HEXINDEZ("FF")'), 255);
  assert.equal(run("BASIS(255;16)"), "FF");
  assert.equal(run("FEST(1234.567;1)"), "1’234.6");
  assert.equal(run('TEXTVOR("Anna Muster";" ")'), "Anna");
  assert.equal(run('TEXTNACH("a-b-c";"-";-1)'), "c");
  assert.equal(run('ZAHLENWERT("1.234,5";",";".")'), 1234.5);
  assert.equal(run("TAGE360(DATUM(2026;1;31);DATUM(2026;3;1))"), 31);
  near(run("BRTEILJAHRE(DATUM(2026;1;1);DATUM(2026;7;1))"), 0.5);
  assert.equal(run("NETTOARBEITSTAGE.INTL(DATUM(2026;10;5);DATUM(2026;10;11);11)"), 6);
  assert.equal(run('ARBEITSTAG.INTL(DATUM(2026;10;9);1;"0000011")'), dateSerial(2026, 10, 12));
  assert.equal(run('TYP("x")'), 2);
  assert.equal(run("FEHLER.TYP(1/0)"), 2);
  assert.equal(run("WAHR()"), true);
  assert.deepEqual(
    area({ A1: "1", A2: "5", A3: "9", B1: "4", B2: "8", E1: "=HÄUFIGKEIT(A1:A3;B1:B2)" }, ["E1", "E2", "E3"]),
    [1, 1, 1],
  );
});

test("Excel-Namen der neuen Funktionen", () => {
  assert.equal(toExcelFormula('FILTERN(A1:A3;B1:B3="x")'), '_xlfn._xlws.FILTER(A1:A3,B1:B3="x")');
  assert.equal(toExcelFormula("EINDEUTIG(A1:A3)"), "_xlfn.UNIQUE(A1:A3)");
  assert.equal(toExcelFormula("LET(x;2;x*3)"), "_xlfn.LET(_xlpm.x,2,_xlpm.x*3)");
  assert.equal(toExcelFormula("BEREICH.VERSCHIEBEN(A1;1;1)"), "OFFSET(A1,1,1)");
  assert.equal(fromExcelFormula("_xlfn.LET(_xlpm.x,2,_xlpm.x*3)"), "LET(x;2;x*3)");
  assert.equal(fromExcelFormula("_xlfn._xlws.SORT(A1:B3,2,-1)"), "SORTIEREN(A1:B3;2;-1)");
  assert.equal(fromExcelFormula("SUBTOTAL(109,A1:A9)"), "TEILERGEBNIS(109;A1:A9)");
});

test("Excel-Datei: überlaufende Formeln als dynamische Matrixformel, beim Öffnen wieder überlaufend", async () => {
  const { buildXlsx, readXlsx } = await import("@/lib/office/xlsx");
  const { readZip, createZip } = await import("@/lib/zip");
  const model = book({ ...team, E1: '=FILTERN(A2:A4;B2:B4="Pflege")', F1: "=SEQUENZ(1;3)" });
  const bytes = buildXlsx(model, { title: "t", author: "a" });
  const files = readZip(bytes);
  const sheet = files.get("xl/worksheets/sheet1.xml")!.toString();
  assert.match(
    sheet,
    /<c r="E1"[^>]*cm="1"><f t="array" ref="E1:E2">_xlfn\._xlws\.FILTER\(A2:A4,B2:B4=&quot;Pflege&quot;\)<\/f>/,
  );
  assert.match(sheet, /<c r="E2" t="inlineStr"><is><t xml:space="preserve">Ben<\/t>/);
  assert.match(sheet, /<c r="H1"><v>3<\/v><\/c>/);
  assert.ok(files.has("xl/metadata.xml"));
  files.delete("carecore/model.json");
  const foreign = readXlsx(createZip([...files.entries()].map(([path, content]) => ({ path, content })))).model;
  assert.equal(foreign.sheets[0].cells.E1.v, '=FILTERN(A2:A4;B2:B4="Pflege")');
  assert.equal(foreign.sheets[0].cells.E2, undefined);
  assert.equal(evaluateWorkbook(foreign).value(0, "E2"), "Ben");
});

test("LAMBDA: direkt aufrufen, über LET benennen, Parameter auslassen, Curry", () => {
  assert.equal(run("LAMBDA(x;x*2)(21)"), 42);
  assert.equal(run("LET(quadrat;LAMBDA(x;x^2);quadrat(5)+quadrat(2))"), 29);
  assert.equal(run("LET(f;LAMBDA(a;b;WENN(ISTAUSGELASSEN(b);a;a+b));f(1)+f(1;10))"), 12);
  assert.equal(run("LAMBDA(x;LAMBDA(y;x+y))(1)(2)"), 3);
  assert.deepEqual(run("LAMBDA(x;x)"), { error: "#CALC!" });
  assert.deepEqual(run("LAMBDA(x;x)(1;2)"), { error: "#VALUE!" });
  assert.equal(run("LET(steuer;0.081;netto;LAMBDA(b;b/(1+steuer));RUNDEN(netto(108.1);2))"), 100);
});

test("ZUORDNEN (MAP), REDUCE, SCAN, NACHZEILE, NACHSPALTE, MATRIXERSTELLEN", () => {
  assert.deepEqual(area({ ...team, E1: "=MAP(C2:C4;LAMBDA(h;h*10))" }, ["E1", "E2", "E3"]), [40, 80, 60]);
  assert.deepEqual(area({ ...team, E1: '=ZUORDNEN(A2:A4;C2:C4;LAMBDA(n;h;n&": "&h))' }, ["E1", "E3"]), [
    "Cem: 4",
    "Ben: 6",
  ]);
  assert.equal(run("REDUCE(0;C2:C4;LAMBDA(summe;wert;summe+wert))", team), 18);
  assert.equal(run("REDUCE(;C2:C4;LAMBDA(a;b;WENN(b>a;b;a)))", team), 8);
  assert.deepEqual(area({ ...team, E1: "=SCAN(0;C2:C4;LAMBDA(a;b;a+b))" }, ["E1", "E2", "E3"]), [4, 12, 18]);
  assert.deepEqual(
    area({ A1: "1", B1: "2", A2: "3", B2: "4", E1: "=NACHZEILE(A1:B2;LAMBDA(z;SUMME(z)))" }, ["E1", "E2"]),
    [3, 7],
  );
  assert.deepEqual(
    area({ A1: "1", B1: "2", A2: "3", B2: "4", E1: "=NACHSPALTE(A1:B2;LAMBDA(s;MAX(s)))" }, ["E1", "F1"]),
    [3, 4],
  );
  assert.deepEqual(area({ E1: "=MATRIXERSTELLEN(2;3;LAMBDA(z;s;z*s))" }, ["E1", "G1", "E2", "G2"]), [1, 3, 2, 6]);
});

test("Überlaufbezug A1#: ganzer Bereich, Rechnen damit, Datei", async () => {
  const cells = { ...team, E1: "=SORTIEREN(C2:C4)", F1: "=SUMME(E1#)", G1: "=ZEILEN(E1#)", H1: "=E1#*2" };
  assert.deepEqual(area(cells, ["F1", "G1", "H1", "H3"]), [18, 3, 8, 16]);
  assert.equal(run("SUMME(C2#)", team), 4, "ohne Überlauf zählt nur die Zelle selbst");
  assert.equal(toExcelFormula("SUMME(E1#)"), "SUM(_xlfn.ANCHORARRAY(E1))");
  assert.equal(fromExcelFormula("SUM(_xlfn.ANCHORARRAY(E1))"), "SUMME(E1#)");
  assert.equal(
    toExcelFormula("LET(f;LAMBDA(x;x+1);f(2))"),
    "_xlfn.LET(_xlpm.f,_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1),_xlpm.f(2))",
  );
  assert.equal(
    fromExcelFormula("_xlfn.LET(_xlpm.f,_xlfn.LAMBDA(_xlpm.x,_xlpm.x+1),_xlpm.f(2))"),
    "LET(f;LAMBDA(x;x+1);f(2))",
  );
  assert.equal(toExcelFormula("MAP(A1:A3;LAMBDA(x;x*2))"), "_xlfn.MAP(A1:A3,_xlfn.LAMBDA(_xlpm.x,_xlpm.x*2))");
});
