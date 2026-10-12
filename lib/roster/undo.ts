// Rückgängig/Wiederholen für Zellen-Änderungen im Dienstplanraster (Kürzel, Stempel, Einfügen,
// Ausschneiden, Leeren, Woche übertragen). Eine Zelle wird über ihren Diensttyp beschrieben; nur Zellen,
// die sich damit vollständig wiederherstellen lassen, sind rückgängig machbar.
import { localTime } from "./time";
import type { SchedulePayload } from "./view-types";

export type UndoCell = { employeeId: string; date: string; before: string | null; after: string | null };
export type UndoEntry = { label: string; cells: UndoCell[]; basis: SchedulePayload };
export type CellTarget = { employeeId: string; date: string; shiftTypeId: string | null };

// Diensttyp der Zelle, null = leer, undefined = nicht über den Diensttyp abbildbar (mehrere Dienste,
// eigene Zeiten, Bemerkung, Zeiterfassung oder maskiert).
export function cellState(data: SchedulePayload, employeeId: string, date: string): string | null | undefined {
  const inCell = data.shifts.filter(
    (shift) => shift.employeeId === employeeId && shift.date === date && shift.unitId === data.unit.id,
  );
  if (!inCell.length) return null;
  const [shift] = inCell;
  if (inCell.length > 1 || shift.masked || shift.entry || shift.notes || !shift.shiftTypeId) return undefined;
  const type = data.shiftTypes.find((t) => t.id === shift.shiftTypeId);
  if (!type) return undefined;
  const standard =
    localTime(shift.plannedStart, data.timezone) === type.startTime &&
    localTime(shift.plannedEnd, data.timezone) === type.endTime &&
    shift.breakMinutes === type.breakMinutes;
  return standard ? type.id : undefined;
}

// Vor dem Anwenden: Ausgangszustand der Zellen. null, wenn eine Zelle nicht wiederherstellbar wäre.
export function undoEntry(data: SchedulePayload, cells: CellTarget[], label: string): UndoEntry | null {
  const unique = new Map(cells.map((cell) => [`${cell.employeeId}|${cell.date}`, cell]));
  const result: UndoCell[] = [];
  for (const cell of unique.values()) {
    const before = cellState(data, cell.employeeId, cell.date);
    if (before === undefined) return null;
    if (before !== cell.shiftTypeId)
      result.push({ employeeId: cell.employeeId, date: cell.date, before, after: cell.shiftTypeId });
  }
  return result.length ? { label, cells: result, basis: data } : null;
}

// Zellen für Rückgängig ("undo": after → before) bzw. Wiederholen ("redo": before → after). Zellen, die
// schon im Zielzustand sind (z. B. wegen Zeiterfassung übersprungen), bleiben aussen vor. Wurde eine Zelle
// inzwischen anders geändert, ist der Schritt nicht mehr sicher möglich (conflict).
export function revertCells(
  data: SchedulePayload,
  entry: UndoEntry,
  direction: "undo" | "redo",
): { cells: CellTarget[] } | { conflict: true } {
  const cells: CellTarget[] = [];
  for (const cell of entry.cells) {
    const [from, to] = direction === "undo" ? [cell.after, cell.before] : [cell.before, cell.after];
    const current = cellState(data, cell.employeeId, cell.date);
    if (current === to) continue;
    if (current !== from) return { conflict: true };
    cells.push({ employeeId: cell.employeeId, date: cell.date, shiftTypeId: to });
  }
  return { cells };
}
