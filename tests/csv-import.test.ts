import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCsv, parseDate, toCsv } from "@/lib/csv-import";

test("CSV: Semikolon oder Komma, Anführungszeichen, BOM, leere Zeilen, Zeilennummern", () => {
  const table = parseCsv(
    '﻿Vorname;Nachname;Notiz\r\nAnna;"Müller; geb. Meier";"sagt ""Grüezi""\nzweite Zeile"\r\n\r\nBen;Berger;\r\n',
  );
  assert.deepEqual(table.header, ["Vorname", "Nachname", "Notiz"]);
  assert.deepEqual(table.rows, [
    { line: 2, cells: ["Anna", "Müller; geb. Meier", 'sagt "Grüezi"\nzweite Zeile'] },
    { line: 5, cells: ["Ben", "Berger", ""] },
  ]);
  assert.deepEqual(parseCsv("Name,Rolle\nLea,pflege").rows, [{ line: 2, cells: ["Lea", "pflege"] }]);
});

test("CSV: Datum TT.MM.JJJJ oder JJJJ-MM-TT, ungültige Tage abgelehnt; Ausgabe für Excel", () => {
  assert.equal(parseDate("3.4.1941"), "1941-04-03");
  assert.equal(parseDate("1941-04-03"), "1941-04-03");
  assert.equal(parseDate("31.02.2020"), null);
  assert.equal(parseDate("04/03/1941"), null);
  assert.equal(
    toCsv([
      ["a;b", 'c"d'],
      ["e", "f"],
    ]),
    '﻿"a;b";"c""d"\r\ne;f\r\n',
  );
});
