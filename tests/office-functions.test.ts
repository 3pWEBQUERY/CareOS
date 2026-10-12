import { test } from "node:test";
import assert from "node:assert/strict";
import { dateSerial, formatWithCode, fromExcelFormula, toExcelFormula, type Value } from "@/lib/office/formula";
import { evaluateWorkbook, newSheet, type SheetModel } from "@/lib/office/model";

function book(cells: Record<string, string>): SheetModel {
  const sheet = newSheet("Tabelle1");
  for (const [key, v] of Object.entries(cells)) sheet.cells[key] = { v };
  return { kind: "sheet", sheets: [sheet] };
}
const run = (formula: string, cells: Record<string, string> = {}): Value =>
  evaluateWorkbook(book({ ...cells, Z99: `=${formula}` }), { today: () => dateSerial(2026, 10, 4) }).value(0, "Z99");

const people = {
  A1: "Anna",
  A2: "Ben",
  A3: "Cem",
  A4: "Dora",
  B1: "Pflege",
  B2: "Küche",
  B3: "Pflege",
  B4: "Pflege",
  C1: "8",
  C2: "6",
  C3: "4",
  C4: "10",
};

test("Funktionen: mehrere Bedingungen", () => {
  assert.equal(run('SUMMEWENNS(C1:C4;B1:B4;"Pflege";C1:C4;">5")', people), 18);
  assert.equal(run('ZÄHLENWENNS(B1:B4;"Pflege";C1:C4;"<9")', people), 2);
  assert.equal(run('MITTELWERTWENNS(C1:C4;B1:B4;"Pflege")', people), 22 / 3);
  assert.equal(run('MAXWENNS(C1:C4;B1:B4;"Pflege")', people), 10);
  assert.equal(run('MINWENNS(C1:C4;B1:B4;"Pflege")', people), 4);
  assert.equal(run('SUMIFS(C1:C4,B1:B4,"Küche")', people), 6);
  assert.deepEqual(run('SUMMEWENNS(C1:C4;B1:B3;"Pflege")', people), { error: "#VALUE!" });
});

test("Funktionen: Nachschlagen", () => {
  assert.equal(run('VERGLEICH("Cem";A1:A4;0)', people), 3);
  assert.equal(run('VERGLEICH("c*";A1:A4;0)', people), 3);
  assert.equal(run("VERGLEICH(7;C3:C4;1)", { C3: "4", C4: "10" }), 1);
  assert.equal(run("INDEX(C1:C4;2)", people), 6);
  assert.equal(run("INDEX(A1:C4;4;3)", people), 10);
  assert.equal(run('INDEX(C1:C4;VERGLEICH("Dora";A1:A4;0))', people), 10);
  assert.equal(run('XVERWEIS("Ben";A1:A4;C1:C4)', people), 6);
  assert.equal(run('XVERWEIS("Zoe";A1:A4;C1:C4;"keiner")', people), "keiner");
  assert.equal(run('XVERWEIS("Pflege";B1:B4;A1:A4;;0;-1)', people), "Dora");
  assert.equal(run("XVERWEIS(7;C1:C4;A1:A4;;1)", people), "Anna");
  assert.equal(run("XVERWEIS(7;C1:C4;A1:A4;;-1)", people), "Ben");
  assert.deepEqual(run('XVERWEIS("Zoe";A1:A4;C1:C4)', people), { error: "#N/A" });
  assert.equal(run("WVERWEIS(2;A1:C2;2;FALSCH)", { A1: "1", B1: "2", C1: "3", A2: "x", B2: "y", C2: "z" }), "y");
  assert.equal(run('WAHL(2;"a";"b";"c")'), "b");
  assert.equal(run("ZEILE(B7)"), 7);
  assert.equal(run("SPALTE(C1)"), 3);
  assert.equal(run("ZEILE()"), 99);
  assert.equal(run("ZEILEN(A1:C4)"), 4);
  assert.equal(run("SPALTEN(A1:C4)"), 3);
});

test("Funktionen: Logik", () => {
  assert.equal(run('WENNS(C1>9;"hoch";C1>5;"mittel";WAHR;"tief")', people), "mittel");
  assert.deepEqual(run("WENNS(FALSCH;1)"), { error: "#N/A" });
  assert.equal(run('ERSTERWERT(2;1;"eins";2;"zwei";"andere")'), "zwei");
  assert.equal(run('ERSTERWERT(9;1;"eins";"andere")'), "andere");
  assert.equal(run("XODER(WAHR;FALSCH)"), true);
  assert.equal(run("XODER(WAHR;WAHR)"), false);
  assert.equal(run('WENNNV(SVERWEIS("x";A1:C4;2;FALSCH);"fehlt")', people), "fehlt");
  assert.equal(run("ISTNV(NV())"), true);
  assert.equal(run("ISTFEHL(1/0)"), true);
  assert.equal(run("ISTFEHL(NV())"), false);
  assert.equal(run("ISTLOG(WAHR)"), true);
  assert.equal(run("ISTGERADE(4)"), true);
  assert.equal(run("ISTUNGERADE(-3)"), true);
});

test("Funktionen: Statistik und Mathematik", () => {
  const values = { A1: "2", A2: "4", A3: "4", A4: "4", A5: "5", A6: "5", A7: "7", A8: "9" };
  assert.equal(run("STABW.N(A1:A8)", values), 2);
  assert.equal(run("VAR.P(A1:A8)", values), 4);
  assert.equal(Number((run("STABW(A1:A8)", values) as number).toFixed(6)), 2.13809);
  assert.equal(run("KGRÖSSTE(A1:A8;2)", values), 7);
  assert.equal(run("KKLEINSTE(A1:A8;1)", values), 2);
  assert.equal(run("RANG(7;A1:A8)", values), 2);
  assert.equal(run("RANG(7;A1:A8;1)", values), 7);
  assert.equal(run("MODALWERT(A1:A8)", values), 4);
  assert.equal(run("SUMMENPRODUKT(A1:A2;A3:A4)", values), 24);
  assert.equal(run("OBERGRENZE(2.3;0.5)"), 2.5);
  assert.equal(run("UNTERGRENZE(2.7;0.5)"), 2.5);
  assert.equal(run("VRUNDEN(7;5)"), 5);
  assert.equal(run("KÜRZEN(-2.75;1)"), -2.7);
  assert.equal(run("VORZEICHEN(-5)"), -1);
  assert.equal(run("GERADE(1.5)"), 2);
  assert.equal(run("UNGERADE(2)"), 3);
  assert.equal(run("QUOTIENT(7;2)"), 3);
  assert.equal(run("GGT(12;18)"), 6);
  assert.equal(run("KGV(4;6)"), 12);
  assert.equal(run("LOG(1000)"), 3);
  assert.deepEqual(run("LN(0)"), { error: "#NUM!" });
  assert.equal(run("RUNDEN(PI();2)"), 3.14);
  const random = run("ZUFALLSBEREICH(1;6)") as number;
  assert.ok(Number.isInteger(random) && random >= 1 && random <= 6);
});

test("Funktionen: Text", () => {
  assert.equal(run('WECHSELN("a-b-c";"-";"/")'), "a/b/c");
  assert.equal(run('WECHSELN("a-b-c";"-";"/";2)'), "a-b/c");
  assert.equal(run('ERSETZEN("Pflegeheim";1;6;"Alters")'), "Altersheim");
  assert.equal(run('FINDEN("e";"Pflege")'), 4);
  assert.deepEqual(run('FINDEN("E";"Pflege")'), { error: "#VALUE!" });
  assert.equal(run('SUCHEN("E";"Pflege")'), 4);
  assert.equal(run('SUCHEN("g?";"Pflege")'), 5);
  assert.equal(run('TEXTVERKETTEN(", ";WAHR;A1:A3)', { A1: "Anna", A3: "Cem" }), "Anna, Cem");
  assert.equal(run('WERT("1\'250.5")'), 1250.5);
  assert.equal(run('GROSS2("anna müller-meier")'), "Anna Müller-Meier");
  assert.equal(run('WIEDERHOLEN("ab";3)'), "ababab");
  assert.equal(run('IDENTISCH("Ab";"ab")'), false);
  assert.equal(run("ZEICHEN(65)"), "A");
  assert.equal(run('CODE("A")'), 65);
  assert.equal(run('TEXT(1234.5;"#\'##0.00")'), "1'234.50");
  assert.equal(run('TEXT(0.256;"0.0%")'), "25.6%");
  assert.equal(run('TEXT(DATUM(2026;10;4);"TT.MM.JJJJ")'), "04.10.2026");
  assert.equal(run('TEXT(DATUM(2026;10;4);"TTTT, D. MMMM YYYY")'), "Sonntag, 4. Oktober 2026");
  assert.equal(run('TEXT(ZEIT(7;5;0);"hh:mm")'), "07:05");
  assert.equal(run('TEXT(3;"0 ""Tage""")'), "3 Tage");
});

test("Funktionen: Datum und Zeit", () => {
  const monday = dateSerial(2026, 10, 5);
  assert.equal(run("WOCHENTAG(DATUM(2026;10;4))"), 1);
  assert.equal(run("WOCHENTAG(DATUM(2026;10;4);2)"), 7);
  assert.equal(run("ISOKALENDERWOCHE(DATUM(2026;1;1))"), 1);
  assert.equal(run("ISOKALENDERWOCHE(DATUM(2027;1;1))"), 53);
  assert.equal(run("KALENDERWOCHE(DATUM(2026;1;4))"), 2);
  assert.equal(run("KALENDERWOCHE(DATUM(2027;1;1);21)"), 53);
  assert.equal(run("TAGE(DATUM(2026;12;25);DATUM(2026;12;1))"), 24);
  assert.equal(run("EDATUM(DATUM(2026;1;31);1)"), dateSerial(2026, 2, 28));
  assert.equal(run("MONATSENDE(DATUM(2026;2;10);0)"), dateSerial(2026, 2, 28));
  assert.equal(run("NETTOARBEITSTAGE(DATUM(2026;10;5);DATUM(2026;10;16))"), 10);
  assert.equal(run("NETTOARBEITSTAGE(DATUM(2026;10;5);DATUM(2026;10;16);A1)", { A1: String(monday) }), 9);
  assert.equal(run("ARBEITSTAG(DATUM(2026;10;2);1)"), monday);
  assert.equal(run('STUNDE("07:30")'), 7);
  assert.equal(run('MINUTE("07:30")'), 30);
  assert.equal(run("ZEIT(12;0;0)"), 0.5);
  assert.equal(run('DATEDIF(DATUM(1950;5;20);DATUM(2026;10;4);"Y")'), 76);
  assert.equal(run('DATEDIF(DATUM(2026;1;31);DATUM(2026;3;1);"M")'), 1);
  assert.equal(run('DATWERT("4.10.2026")'), dateSerial(2026, 10, 4));
  assert.equal(run('ZEITWERT("18:00")'), 0.75);
});

test("Funktionen: Excel-Namen beim Speichern und Öffnen", () => {
  assert.equal(toExcelFormula("XVERWEIS(A1;B:B;C:C)"), "_xlfn.XLOOKUP(A1,B:B,C:C)");
  assert.equal(toExcelFormula('SUMMEWENNS(A1:A3;B1:B3;"x")'), 'SUMIFS(A1:A3,B1:B3,"x")');
  assert.equal(toExcelFormula("STABW.N(A1:A3)"), "_xlfn.STDEV.P(A1:A3)");
  assert.equal(fromExcelFormula("_xlfn.XLOOKUP(A1,B:B,C:C)"), "XVERWEIS(A1;B:B;C:C)");
  assert.equal(fromExcelFormula("_xlfn.IFS(A1>1,1,TRUE,0)"), "WENNS(A1>1;1;WAHR;0)");
  assert.equal(fromExcelFormula("RANK.EQ(A1,A1:A9)"), "RANG(A1;A1:A9)");
  assert.equal(formatWithCode(-5, '0;"minus "0'), "minus 5");
  assert.equal(formatWithCode("Anna", '0;0;0;"Name: "@'), "Name: Anna");
});

test("Formelhilfe: englische Namen finden die deutsche Hilfe, Beispiele für LAMBDA-Helfer", async () => {
  const { functionHelp, suggestFunctions } = await import("@/lib/office/formula");
  assert.equal(functionHelp("BYROW")?.name, "NACHZEILE");
  assert.equal(functionHelp("nachzeile")?.name, "NACHZEILE");
  assert.match(functionHelp("BYROW")?.example ?? "", /NACHZEILE\(B2:D10;LAMBDA\(zeile;SUMME\(zeile\)\)\)/);
  assert.match(functionHelp("BYCOL")?.example ?? "", /NACHSPALTE/);
  assert.ok(functionHelp("MAKEARRAY")?.example);
  const typed = suggestFunctions("BYR");
  assert.equal(typed[0].name, "NACHZEILE");
  assert.equal(typed[0].english, "BYROW");
  assert.equal(suggestFunctions("NACHZ")[0].name, "NACHZEILE");
  assert.equal(suggestFunctions("NACHZ")[0].english, undefined);
});
