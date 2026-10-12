// Blattschutz und Pivot-Tabellen: welche Änderungen an einem Blatt erlaubt sind. Geprüft wird der Unterschied
// zwischen vorher und nachher, damit jeder Weg (Tippen, Einfügen, Ausfüllen, Formatieren, Zeilen einfügen …)
// gleich behandelt wird.
import { stableKey } from "@/lib/office/merge";
import type { Sheet, SheetModel } from "@/lib/office/model";

export const PROTECTED_MESSAGE = "Das Blatt ist geschützt. Zum Ändern zuerst den Blattschutz aufheben (Überprüfen).";
export const PIVOT_MESSAGE = "Eine Pivot-Tabelle ändert sich nur über „Pivot-Tabelle aktualisieren“ oder „bearbeiten“.";

// Gesperrt: auf einem geschützten Blatt alle Zellen ausser den freigegebenen, auf einer Pivot-Tabelle alle.
export const cellLocked = (sheet: Sheet, key: string) =>
  Boolean(sheet.pivot) || (Boolean(sheet.protected) && !sheet.cells[key]?.s?.unlocked);

// Erlaubt bleiben: Werte in freigegebenen Zellen, Kommentare, Ein- und Ausschalten des Schutzes.
function sheetBlock(before: Sheet, after: Sheet): string | null {
  if (!before.protected && !before.pivot) return null;
  if (before.protected && !after.protected && !before.pivot) return null;
  const message = before.pivot ? PIVOT_MESSAGE : PROTECTED_MESSAGE;
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if (key === "cells" || key === "comments" || key === "protected") continue;
    // Pivot-Tabelle: nur Inhalt und Aufbau sind fest; Spaltenbreiten, Ansicht und Druck bleiben frei.
    if (before.pivot && key !== "pivot") continue;
    if (stableKey(before[key as keyof Sheet]) !== stableKey(after[key as keyof Sheet])) return message;
  }
  if (before.pivot && Boolean(before.protected) !== Boolean(after.protected)) return message;
  const cells = new Set([...Object.keys(before.cells), ...Object.keys(after.cells)]);
  for (const key of cells) {
    const old = before.cells[key];
    const next = after.cells[key];
    if (stableKey(old) === stableKey(next)) continue;
    if (cellLocked(before, key)) return message;
    // Freigegebene Zelle: nur der Inhalt, nicht das Format.
    if (stableKey(old?.s) !== stableKey(next?.s)) return message;
  }
  return null;
}

// Für den ganzen Stand der Arbeitsmappe: Blätter hinzufügen, umbenennen oder löschen bleibt erlaubt.
export function protectionBlock(before: SheetModel, after: SheetModel): string | null {
  for (const sheet of before.sheets) {
    const next = after.sheets.find((item) => item.id === sheet.id);
    if (!next || next === sheet) continue;
    const renamed = next.name !== sheet.name ? { ...next, name: sheet.name } : next;
    const block = sheetBlock(sheet, renamed);
    if (block) return block;
  }
  return null;
}
