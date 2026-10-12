// CSV für Excel und Lohnbuchhaltung (Schweiz/Deutschland): Semikolon als Trennzeichen, UTF-8 mit BOM,
// Dezimalkomma. Reine Funktionen ohne Datenbank.

export type CsvValue = string | number | null | undefined;

const cell = (value: CsvValue) => {
  if (value === null || value === undefined) return "";
  // Texte, die Excel als Formel ausführen würde (=, +, -, @, Tab), beginnen mit einem Apostroph.
  const text =
    typeof value === "number" ? String(value).replace(".", ",") : /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\n\r]/.test(text) || /^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

export function toCsv(rows: CsvValue[][]) {
  return "﻿" + rows.map((row) => row.map(cell).join(";")).join("\r\n") + "\r\n";
}

// Minuten → Stunden mit zwei Nachkommastellen (8,50), wie in der Lohnbuchhaltung üblich.
export const decimalHours = (minutes: number | null | undefined) =>
  minutes === null || minutes === undefined ? null : Math.round((minutes / 60) * 100) / 100;

// Dateinamen ohne Umlaute und Sonderzeichen.
export const fileSlug = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
