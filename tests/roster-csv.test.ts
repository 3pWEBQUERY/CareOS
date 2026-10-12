import { test } from "node:test";
import assert from "node:assert/strict";
import { decimalHours, fileSlug, toCsv } from "@/lib/roster/csv";

test("CSV für Excel: BOM, Semikolon, Dezimalkomma, Anführungszeichen nur wo nötig", () => {
  const csv = toCsv([
    ["Person", "Ist (h)", "Notiz"],
    ["Anna Müller", 8.5, 'Sagt "ok"; danach'],
    ["Max", -1.25, null],
  ]);
  assert.ok(csv.startsWith("﻿"));
  assert.equal(csv.slice(1), 'Person;Ist (h);Notiz\r\nAnna Müller;8,5;"Sagt ""ok""; danach"\r\nMax;-1,25;\r\n');
});

test("Minuten als Dezimalstunden und Dateinamen ohne Sonderzeichen", () => {
  assert.equal(decimalHours(510), 8.5);
  assert.equal(decimalHours(-100), -1.67);
  assert.equal(decimalHours(null), null);
  assert.equal(fileSlug("Wohngruppe Löwenzahn / 1. OG"), "wohngruppe-lowenzahn-1-og");
});

test("CSV: Texte, die Excel als Formel ausführen würde, werden entschärft", () => {
  const csv = toCsv([['=HYPERLINK("http://x")', "+41 44 000", "-5", "@SUM(A1)", "Anna", -5]]);
  assert.equal(csv, '﻿"\'=HYPERLINK(""http://x"")";\'+41 44 000;\'-5;\'@SUM(A1);Anna;-5\r\n');
});
