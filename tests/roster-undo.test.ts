import { test } from "node:test";
import assert from "node:assert/strict";
import { cellState, revertCells, undoEntry } from "@/lib/roster/undo";
import type { GridShift, SchedulePayload } from "@/lib/roster/view-types";
import type { ShiftTypeInfo } from "@/lib/roster/types";

const UNIT = "u1";
const type = (id: string, code: string, startTime: string, endTime: string): ShiftTypeInfo => ({
  id,
  careUnitId: UNIT,
  name: code,
  code,
  category: "WORK",
  absenceKind: null,
  startTime,
  endTime,
  breakMinutes: 30,
  color: "#2563eb",
  workTimeFactor: 1,
  creditsTarget: true,
  requiredQualificationIds: [],
  active: true,
  sortOrder: 0,
});
const types = [type("F", "F", "07:00", "15:30"), type("S", "S", "14:00", "22:30")];
// Sommerzeit: 07:00 Zürich = 05:00 UTC.
const shift = (employeeId: string, date: string, typeId: string, extra: Partial<GridShift> = {}): GridShift => {
  const t = types.find((x) => x.id === typeId)!;
  const utc = (time: string) =>
    `${date}T${String(Number(time.slice(0, 2)) - 2).padStart(2, "0")}:${time.slice(3)}:00.000Z`;
  return {
    id: `${employeeId}-${date}-${typeId}`,
    employeeId,
    unitId: UNIT,
    shiftTypeId: typeId,
    code: t.code,
    name: t.name,
    color: t.color,
    category: t.category,
    absenceKind: null,
    date,
    plannedStart: utc(t.startTime),
    plannedEnd: utc(t.endTime),
    breakMinutes: 30,
    netMinutes: 480,
    source: "MANUAL",
    notes: null,
    version: 1,
    swapped: null,
    entry: null,
    violations: [],
    masked: false,
    ...extra,
  };
};
const payload = (shifts: GridShift[]) =>
  ({
    unit: { id: UNIT, name: "WG" },
    timezone: "Europe/Zurich",
    shiftTypes: types,
    shifts,
  }) as unknown as SchedulePayload;

test("Zellzustand: Diensttyp, leer oder nicht wiederherstellbar", () => {
  const data = payload([
    shift("a", "2026-06-01", "F"),
    shift("a", "2026-06-02", "F", { notes: "Übergabe" }),
    shift("a", "2026-06-03", "F", { plannedStart: "2026-06-03T06:00:00.000Z" }),
    shift("b", "2026-06-01", "F", { unitId: "andere" }),
  ]);
  assert.equal(cellState(data, "a", "2026-06-01"), "F");
  assert.equal(cellState(data, "a", "2026-06-04"), null);
  assert.equal(cellState(data, "a", "2026-06-02"), undefined);
  assert.equal(cellState(data, "a", "2026-06-03"), undefined);
  assert.equal(cellState(data, "b", "2026-06-01"), null);
});

test("Rückgängig und Wiederholen stellen die Zellen her, unveränderte Zellen fallen weg", () => {
  const before = payload([shift("a", "2026-06-01", "F")]);
  const entry = undoEntry(
    before,
    [
      { employeeId: "a", date: "2026-06-01", shiftTypeId: "S" },
      { employeeId: "a", date: "2026-06-02", shiftTypeId: "S" },
      { employeeId: "b", date: "2026-06-01", shiftTypeId: null },
    ],
    "S gesetzt",
  );
  assert.ok(entry);
  assert.deepEqual(entry.cells, [
    { employeeId: "a", date: "2026-06-01", before: "F", after: "S" },
    { employeeId: "a", date: "2026-06-02", before: null, after: "S" },
  ]);
  const after = payload([shift("a", "2026-06-01", "S"), shift("a", "2026-06-02", "S")]);
  assert.deepEqual(revertCells(after, entry, "undo"), {
    cells: [
      { employeeId: "a", date: "2026-06-01", shiftTypeId: "F" },
      { employeeId: "a", date: "2026-06-02", shiftTypeId: null },
    ],
  });
  assert.deepEqual(revertCells(before, entry, "redo"), {
    cells: [
      { employeeId: "a", date: "2026-06-01", shiftTypeId: "S" },
      { employeeId: "a", date: "2026-06-02", shiftTypeId: "S" },
    ],
  });
  // Übersprungene Zelle (z. B. Zeiterfassung) ist schon im Zielzustand.
  const partly = payload([shift("a", "2026-06-01", "F"), shift("a", "2026-06-02", "S")]);
  assert.deepEqual(revertCells(partly, entry, "undo"), {
    cells: [{ employeeId: "a", date: "2026-06-02", shiftTypeId: null }],
  });
});

test("Inzwischen anders geänderte oder nicht abbildbare Zellen verhindern Rückgängig", () => {
  const entry = undoEntry(payload([]), [{ employeeId: "a", date: "2026-06-01", shiftTypeId: "F" }], "F gesetzt");
  assert.ok(entry);
  assert.deepEqual(revertCells(payload([shift("a", "2026-06-01", "S")]), entry, "undo"), { conflict: true });
  assert.deepEqual(revertCells(payload([shift("a", "2026-06-01", "F", { notes: "neu" })]), entry, "undo"), {
    conflict: true,
  });
  assert.equal(
    undoEntry(
      payload([shift("a", "2026-06-01", "F", { notes: "x" })]),
      [{ employeeId: "a", date: "2026-06-01", shiftTypeId: null }],
      "Zellen geleert",
    ),
    null,
  );
  assert.equal(undoEntry(payload([]), [{ employeeId: "a", date: "2026-06-01", shiftTypeId: null }], "leer"), null);
});
