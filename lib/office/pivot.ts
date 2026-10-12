// Pivot-Tabelle: fasst einen Bereich mit Überschriften nach einem Feld (Zeilen) und optional einem zweiten Feld
// (Spalten) zusammen, mit Summe, Anzahl, Mittelwert, Minimum oder Maximum eines Wertfelds und Gesamtergebnissen.
import { cellKey, isError, parseArea, parseInput, type Area, type Value } from "@/lib/office/formula";
import {
  PIVOT_FUNCTIONS,
  formatValue,
  type CellStyle,
  type PivotFunction,
  type Sheet,
  type SheetCell,
  type SheetModel,
  type SheetPivot,
} from "@/lib/office/model";

export const PIVOT_EMPTY = "(Leer)";
export const PIVOT_TOTAL = "Gesamtergebnis";

export type PivotResult = { cells: Record<string, SheetCell>; rows: number; cols: number } | { error: string };

// Überschriften des Bereichs (erste Zeile) als Feldnamen; leere Überschriften als „Spalte B“.
export function pivotFields(sheet: Sheet, area: Area, valueOf: (col: number, row: number) => Value) {
  return Array.from({ length: area.c2 - area.c1 + 1 }, (_, index) => {
    const value = valueOf(area.c1 + index, area.r1);
    const text =
      value === null || isError(value) ? "" : formatValue(value, sheet.cells[cellKey(area.c1 + index, area.r1)]?.s);
    return text.trim() || `Spalte ${cellKey(area.c1 + index, 0).replace(/\d+$/, "")}`;
  });
}

type Group = { label: string; sort: number | string };

const aggregate = (fn: PivotFunction, values: Value[]): number | null => {
  if (fn === "count") return values.filter((value) => value !== null && value !== "").length;
  const numbers = values.filter((value): value is number => typeof value === "number");
  if (!numbers.length) return fn === "sum" ? 0 : null;
  if (fn === "sum") return numbers.reduce((sum, value) => sum + value, 0);
  if (fn === "average") return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
  return fn === "min" ? Math.min(...numbers) : Math.max(...numbers);
};

// Zahlen ohne Rundungsrauschen speichern (0.1 + 0.2 → 0.3).
const store = (value: number) => String(Number(value.toPrecision(15)));
// Beschriftungen als Text: nur mit vorangestelltem ' wo sie sonst als Zahl, Datum oder Formel gelten würden.
const label = (text: string) => (parseInput(text).type === "text" ? text : `'${text}`);

export function buildPivot(
  model: SheetModel,
  pivot: SheetPivot,
  valueOf: (sheetIndex: number, key: string) => Value,
): PivotResult {
  const sourceIndex = model.sheets.findIndex((sheet) => sheet.id === pivot.source);
  if (sourceIndex < 0) return { error: "Das Blatt mit den Quelldaten gibt es nicht mehr." };
  const source = model.sheets[sourceIndex];
  const area = parseArea(pivot.range);
  if (!area || area.r2 <= area.r1)
    return { error: "Der Quellbereich braucht Überschriften und mindestens eine Zeile." };
  const width = area.c2 - area.c1 + 1;
  if ([pivot.rows, pivot.value, pivot.cols ?? 0].some((field) => field >= width))
    return { error: "Ein Feld liegt ausserhalb des Quellbereichs." };
  const at = (col: number, row: number) => valueOf(sourceIndex, cellKey(col, row));
  const fields = pivotFields(source, area, at);
  const groupOf = (col: number, row: number): Group => {
    const value = at(col, row);
    if (value === null || value === "" || isError(value)) return { label: PIVOT_EMPTY, sort: "￿" };
    const text = formatValue(value, source.cells[cellKey(col, row)]?.s);
    return { label: text, sort: typeof value === "number" ? value : text.toLocaleLowerCase("de-CH") };
  };
  // Zahlen aufsteigend, dann Text alphabetisch, „(Leer)“ zuletzt (wie in Excel).
  const ordered = (groups: Map<string, Group>) =>
    [...groups.values()].sort((a, b) =>
      a.label === PIVOT_EMPTY || b.label === PIVOT_EMPTY
        ? Number(a.label === PIVOT_EMPTY) - Number(b.label === PIVOT_EMPTY)
        : typeof a.sort === "number" && typeof b.sort === "number"
          ? a.sort - b.sort
          : typeof a.sort === "number"
            ? -1
            : typeof b.sort === "number"
              ? 1
              : a.sort.localeCompare(b.sort, "de-CH"),
    );

  const rowGroups = new Map<string, Group>();
  const colGroups = new Map<string, Group>();
  const buckets = new Map<string, Value[]>();
  const push = (key: string, value: Value) => buckets.set(key, [...(buckets.get(key) ?? []), value]);
  for (let row = area.r1 + 1; row <= area.r2; row += 1) {
    // Ganz leere Zeilen gehören nicht zu den Daten.
    if (
      Array.from({ length: width }, (_, index) => at(area.c1 + index, row)).every(
        (value) => value === null || value === "",
      )
    )
      continue;
    const rowGroup = groupOf(area.c1 + pivot.rows, row);
    const colGroup = pivot.cols === null ? { label: "", sort: "" } : groupOf(area.c1 + pivot.cols, row);
    rowGroups.set(rowGroup.label, rowGroup);
    if (pivot.cols !== null) colGroups.set(colGroup.label, colGroup);
    const value = at(area.c1 + pivot.value, row);
    push(`${rowGroup.label}\u0000${colGroup.label}`, value);
    push(`${rowGroup.label}\u0000*`, value);
    push(`*\u0000${colGroup.label}`, value);
    push("*\u0000*", value);
  }
  if (!rowGroups.size) return { error: "Der Quellbereich enthält keine Daten." };

  const rows = ordered(rowGroups);
  const cols = pivot.cols === null ? [] : ordered(colGroups);
  const valueStyle: CellStyle | undefined =
    pivot.fn === "count"
      ? { fmt: "integer" }
      : (() => {
          const style = source.cells[cellKey(area.c1 + pivot.value, area.r1 + 1)]?.s;
          return style?.fmt ? { fmt: style.fmt, ...(style.dec !== undefined ? { dec: style.dec } : {}) } : undefined;
        })();
  const head: CellStyle = { b: true, fill: "#e8eef9", bb: true, bc: "#8aa4d6" };
  const total: CellStyle = { b: true, bt: true, bc: "#8aa4d6" };
  const cells: Record<string, SheetCell> = {};
  const put = (col: number, row: number, v: string, style?: CellStyle) => {
    if (v || style) cells[cellKey(col, row)] = style ? { v, s: style } : { v };
  };
  const result = (rowLabel: string, colLabel: string) =>
    aggregate(pivot.fn, buckets.get(`${rowLabel}\u0000${colLabel}`) ?? []);
  const number = (value: number | null) => (value === null ? "" : store(value));
  const title = `${PIVOT_FUNCTIONS[pivot.fn]} von ${fields[pivot.value]}`;

  if (pivot.cols === null) {
    put(0, 0, label(fields[pivot.rows]), head);
    put(1, 0, label(title), { ...head, align: "right" });
    rows.forEach((group, index) => {
      put(0, index + 1, label(group.label));
      put(1, index + 1, number(result(group.label, "")), valueStyle);
    });
    put(0, rows.length + 1, label(PIVOT_TOTAL), total);
    put(1, rows.length + 1, number(result("*", "*")), { ...total, ...valueStyle });
    return { cells, rows: rows.length + 2, cols: 2 };
  }

  // Mit Spaltenfeld: erste Zeile Wertfeld und Spaltenfeld, zweite Zeile die Spaltengruppen.
  put(0, 0, label(title), head);
  put(1, 0, label(fields[pivot.cols]), head);
  for (let col = 2; col <= cols.length + 1; col += 1) put(col, 0, "", head);
  put(0, 1, label(fields[pivot.rows]), head);
  cols.forEach((group, index) => put(index + 1, 1, label(group.label), { ...head, align: "right" }));
  put(cols.length + 1, 1, label(PIVOT_TOTAL), { ...head, align: "right" });
  rows.forEach((group, index) => {
    const row = index + 2;
    put(0, row, label(group.label));
    cols.forEach((colGroup, colIndex) =>
      put(colIndex + 1, row, number(result(group.label, colGroup.label)), valueStyle),
    );
    put(cols.length + 1, row, number(result(group.label, "*")), { b: true, ...valueStyle });
  });
  const last = rows.length + 2;
  put(0, last, label(PIVOT_TOTAL), total);
  cols.forEach((colGroup, colIndex) =>
    put(colIndex + 1, last, number(result("*", colGroup.label)), { ...total, ...valueStyle }),
  );
  put(cols.length + 1, last, number(result("*", "*")), { ...total, ...valueStyle });
  return { cells, rows: rows.length + 3, cols: cols.length + 2 };
}

// Blatt mit der Pivot-Tabelle neu berechnen (Spaltenbreiten und Ansicht bleiben).
export function refreshPivotSheet(
  model: SheetModel,
  sheet: Sheet,
  valueOf: (sheetIndex: number, key: string) => Value,
): Sheet | { error: string } {
  if (!sheet.pivot) return { error: "Dieses Blatt enthält keine Pivot-Tabelle." };
  const built = buildPivot(model, sheet.pivot, valueOf);
  if ("error" in built) return built;
  return {
    ...sheet,
    cells: built.cells,
    rowCount: Math.max(sheet.rowCount, built.rows + 10),
    colCount: Math.max(sheet.colCount, built.cols + 2),
    // Breitere Spalten für Beschriftungen und Werte (eigene Breiten bleiben).
    cols: {
      ...sheet.cols,
      ...Object.fromEntries(
        Array.from({ length: built.cols }, (_, col) => [
          String(col),
          sheet.cols[String(col)] ?? (col === 0 ? 200 : 150),
        ]),
      ),
    },
  };
}
