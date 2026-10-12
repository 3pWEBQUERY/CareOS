// Datenübernahme aus CSV (Excel „CSV UTF-8“ oder „CSV (Trennzeichen-getrennt)“): Spalten per Kopfzeile, Trennzeichen
// Semikolon oder Komma (aus der Kopfzeile erkannt), Anführungszeichen nach RFC 4180, BOM wird entfernt.

export type CsvTable = { header: string[]; rows: Array<{ line: number; cells: string[] }> };

export function parseCsv(text: string): CsvTable {
  const source = text.replace(/^﻿/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const separator = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const records: Array<{ line: number; cells: string[] }> = [];
  let cells: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let recordLine = 1;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else {
        if (char === "\n") line++;
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") quoted = true;
    else if (char === separator) {
      cells.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      cells.push(cell);
      records.push({ line: recordLine, cells });
      cells = [];
      cell = "";
      line++;
      recordLine = line;
    } else cell += char;
  }
  if (cell !== "" || cells.length) {
    cells.push(cell);
    records.push({ line: recordLine, cells });
  }
  const nonEmpty = records.filter((record) => record.cells.some((value) => value.trim() !== ""));
  const [head, ...rows] = nonEmpty;
  return {
    header: (head?.cells ?? []).map((value) => value.trim()),
    rows: rows.map((row) => ({ line: row.line, cells: row.cells.map((value) => value.trim()) })),
  };
}

// Datum als TT.MM.JJJJ (auch T.M.JJJJ) oder JJJJ-MM-TT; ungültige Kalendertage ergeben null.
export function parseDate(value: string): string | null {
  const swiss = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const [year, month, day] = swiss
    ? [Number(swiss[3]), Number(swiss[2]), Number(swiss[1])]
    : iso
      ? [Number(iso[1]), Number(iso[2]), Number(iso[3])]
      : [0, 0, 0];
  if (!year) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// CSV-Ausgabe (Vorlagen, Liste der Startpasswörter) mit Semikolon und BOM, damit Excel Umlaute richtig zeigt.
export function toCsv(rows: string[][]) {
  const escape = (value: string) => (/[;"\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return `﻿${rows.map((row) => row.map(escape).join(";")).join("\r\n")}\r\n`;
}
