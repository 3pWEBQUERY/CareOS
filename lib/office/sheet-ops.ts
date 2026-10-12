// Bearbeitungsschritte der Tabelle (unveränderlich: jeder Schritt liefert ein neues Modell, das Rückgängig erlaubt).
import {
  adjustForInsertDelete,
  cellKey,
  parseArea,
  parseCellKey,
  parseInput,
  renameSheetReferences,
  shiftFormula,
  type Area,
} from "./formula";
import { shiftArea, shiftRangeText } from "./sheet-features";
import type { CommentThread } from "./comments";
import { newId, type CellStyle, type Sheet, type SheetCell, type SheetModel } from "./model";

export type Pos = { col: number; row: number };
export type Range = { anchor: Pos; focus: Pos };

export const areaOf = (range: Range): Area => ({
  c1: Math.min(range.anchor.col, range.focus.col),
  r1: Math.min(range.anchor.row, range.focus.row),
  c2: Math.max(range.anchor.col, range.focus.col),
  r2: Math.max(range.anchor.row, range.focus.row),
});

export const inArea = (area: Area, col: number, row: number) =>
  col >= area.c1 && col <= area.c2 && row >= area.r1 && row <= area.r2;

export const overlaps = (a: Area, b: Area) => a.c1 <= b.c2 && b.c1 <= a.c2 && a.r1 <= b.r2 && b.r1 <= a.r2;

export function mergesOf(sheet: Sheet) {
  return sheet.merges.map(parseArea).filter((area): area is Area => area !== null);
}

// Auswahl auf verbundene Zellen ausdehnen, die nur teilweise darin liegen.
export function expandToMerges(area: Area, merges: Area[]): Area {
  let result = { ...area };
  let changed = true;
  while (changed) {
    changed = false;
    for (const merge of merges)
      if (overlaps(result, merge)) {
        const next = {
          c1: Math.min(result.c1, merge.c1),
          r1: Math.min(result.r1, merge.r1),
          c2: Math.max(result.c2, merge.c2),
          r2: Math.max(result.r2, merge.r2),
        };
        if (next.c1 !== result.c1 || next.r1 !== result.r1 || next.c2 !== result.c2 || next.r2 !== result.r2) {
          result = next;
          changed = true;
        }
      }
  }
  return result;
}

export function replaceSheet(model: SheetModel, index: number, sheet: Sheet): SheetModel {
  return { ...model, sheets: model.sheets.map((item, position) => (position === index ? sheet : item)) };
}

function putCell(cells: Record<string, SheetCell>, key: string, cell: SheetCell | null) {
  if (!cell || (cell.v === "" && (!cell.s || !Object.keys(cell.s).length))) delete cells[key];
  else cells[key] = cell.s && !Object.keys(cell.s).length ? { v: cell.v } : cell;
}

// Eingabe übernehmen; Datum, Uhrzeit und Prozent erhalten automatisch das passende Format.
export function setValue(sheet: Sheet, pos: Pos, raw: string): Sheet {
  const key = cellKey(pos.col, pos.row);
  const cells = { ...sheet.cells };
  const current = cells[key];
  let style = current?.s;
  const parsed = parseInput(raw);
  if (parsed.type === "number" && parsed.format && (!style?.fmt || style.fmt === "general"))
    style = { ...style, fmt: parsed.format };
  putCell(cells, key, { v: raw, ...(style ? { s: style } : {}) });
  return { ...sheet, cells };
}

export function setValues(sheet: Sheet, entries: { pos: Pos; cell: SheetCell | null }[]): Sheet {
  const cells = { ...sheet.cells };
  for (const { pos, cell } of entries) putCell(cells, cellKey(pos.col, pos.row), cell);
  const maxRow = Math.max(sheet.rowCount, ...entries.map((entry) => entry.pos.row + 1));
  const maxCol = Math.max(sheet.colCount, ...entries.map((entry) => entry.pos.col + 1));
  return { ...sheet, cells, rowCount: Math.min(10_000, maxRow), colCount: Math.min(200, maxCol) };
}

export function clearArea(sheet: Sheet, area: Area, what: "content" | "formats" | "all"): Sheet {
  const cells = { ...sheet.cells };
  for (const key of Object.keys(cells)) {
    const ref = parseCellKey(key);
    if (!ref || !inArea(area, ref.col, ref.row)) continue;
    if (what === "all") delete cells[key];
    else if (what === "formats") putCell(cells, key, { v: cells[key].v });
    else putCell(cells, key, { v: "", s: cells[key].s });
  }
  if (what !== "all" || !sheet.comments) return { ...sheet, cells };
  return { ...sheet, cells, comments: keepComments(sheet.comments, (col, row) => !inArea(area, col, row)) };
}

// Kommentare (je Zelle) verschieben oder entfernen: target liefert die neue Zelle oder null.
function moveComments(
  comments: Record<string, CommentThread> | undefined,
  target: (col: number, row: number) => string | null,
): Record<string, CommentThread> | undefined {
  if (!comments) return comments;
  const out: Record<string, CommentThread> = {};
  for (const [key, thread] of Object.entries(comments)) {
    const ref = parseCellKey(key);
    const next = ref ? target(ref.col, ref.row) : null;
    if (next) out[next] = thread;
  }
  return out;
}
const keepComments = (comments: Record<string, CommentThread>, keep: (col: number, row: number) => boolean) =>
  moveComments(comments, (col, row) => (keep(col, row) ? cellKey(col, row) : null));

export function styleArea(sheet: Sheet, area: Area, change: (style: CellStyle) => CellStyle): Sheet {
  const cells = { ...sheet.cells };
  for (let row = area.r1; row <= area.r2; row += 1)
    for (let col = area.c1; col <= area.c2; col += 1) {
      const key = cellKey(col, row);
      const current = cells[key];
      const style = change({ ...(current?.s ?? {}) });
      for (const name of Object.keys(style) as (keyof CellStyle)[])
        if (style[name] === undefined || style[name] === false) delete style[name];
      putCell(cells, key, { v: current?.v ?? "", s: style });
    }
  return { ...sheet, cells };
}

// Formeln aller Blätter anpassen, wenn auf einem Blatt Zeilen oder Spalten dazukommen oder wegfallen.
function adjustFormulas(model: SheetModel, sheetIndex: number, axis: "row" | "col", index: number, count: number) {
  const target = model.sheets[sheetIndex].name.toLocaleLowerCase("de-CH");
  return model.sheets.map((sheet, position) => {
    let changed = false;
    const cells: Record<string, SheetCell> = {};
    for (const [key, cell] of Object.entries(sheet.cells)) {
      if (!cell.v.startsWith("=")) {
        cells[key] = cell;
        continue;
      }
      const next = `=${adjustForInsertDelete(cell.v.slice(1), axis, index, count, (name) =>
        name === undefined ? position === sheetIndex : name.toLocaleLowerCase("de-CH") === target,
      )}`;
      if (next !== cell.v) changed = true;
      cells[key] = next === cell.v ? cell : { ...cell, v: next };
    }
    return changed ? { ...sheet, cells } : sheet;
  });
}

// Zeilen/Spalten einfügen (count > 0) oder löschen (count < 0) – samt Inhalt, Breiten, verbundenen Zellen.
export function insertDelete(
  model: SheetModel,
  sheetIndex: number,
  axis: "row" | "col",
  index: number,
  count: number,
): SheetModel {
  const sheets = adjustFormulas(model, sheetIndex, axis, index, count);
  const sheet = sheets[sheetIndex];
  const removed = count < 0 ? -count : 0;
  const move = (value: number) => {
    if (count > 0) return value >= index ? value + count : value;
    if (value >= index && value < index + removed) return null;
    return value >= index + removed ? value - removed : value;
  };
  const cells: Record<string, SheetCell> = {};
  for (const [key, cell] of Object.entries(sheet.cells)) {
    const ref = parseCellKey(key);
    if (!ref) continue;
    const moved = move(axis === "row" ? ref.row : ref.col);
    if (moved === null) continue;
    cells[axis === "row" ? cellKey(ref.col, moved) : cellKey(moved, ref.row)] = cell;
  }
  const sizes = (source: Record<string, number>) => {
    const out: Record<string, number> = {};
    for (const [key, value] of Object.entries(source)) {
      const moved = move(Number(key));
      if (moved !== null) out[String(moved)] = value;
    }
    return out;
  };
  const merges = mergesOf(sheet).flatMap((area) => {
    const next = shiftArea(area, axis, index, count);
    if (!next || (next.c1 === next.c2 && next.r1 === next.r2)) return [];
    return [`${cellKey(next.c1, next.r1)}:${cellKey(next.c2, next.r2)}`];
  });
  const shiftRange = (range: string) => shiftRangeText(range, axis, index, count);
  const indexes = (list: number[]) => list.map(move).filter((value): value is number => value !== null);
  let filter = sheet.filter;
  if (filter) {
    const range = shiftRange(filter.range);
    if (!range) filter = null;
    else {
      const hidden: Record<string, string[]> = {};
      for (const [col, values] of Object.entries(filter.hidden)) {
        const moved = axis === "col" ? move(Number(col)) : Number(col);
        if (moved !== null) hidden[String(moved)] = values;
      }
      filter = { range, hidden };
    }
  }
  const updated: Sheet = {
    ...sheet,
    cells,
    cols: axis === "col" ? sizes(sheet.cols) : sheet.cols,
    rows: axis === "row" ? sizes(sheet.rows) : sheet.rows,
    merges,
    hiddenRows: axis === "row" ? indexes(sheet.hiddenRows) : sheet.hiddenRows,
    hiddenCols: axis === "col" ? indexes(sheet.hiddenCols) : sheet.hiddenCols,
    filter,
    validations: sheet.validations.flatMap((item) => {
      const range = shiftRange(item.range);
      return range ? [{ ...item, range }] : [];
    }),
    rules: sheet.rules.flatMap((rule) => {
      const range = shiftRange(rule.range);
      return range ? [{ ...rule, range }] : [];
    }),
    charts: sheet.charts.flatMap((chart) => {
      const range = shiftRange(chart.range);
      return range ? [{ ...chart, range }] : [];
    }),
    ...(sheet.comments
      ? {
          comments: moveComments(sheet.comments, (col, row) => {
            const moved = move(axis === "row" ? row : col);
            if (moved === null) return null;
            return axis === "row" ? cellKey(col, moved) : cellKey(moved, row);
          }),
        }
      : {}),
    rowCount: axis === "row" ? Math.max(1, Math.min(10_000, sheet.rowCount + count)) : sheet.rowCount,
    colCount: axis === "col" ? Math.max(1, Math.min(200, sheet.colCount + count)) : sheet.colCount,
  };
  return { ...model, sheets: sheets.map((item, position) => (position === sheetIndex ? updated : item)) };
}

export function renameSheet(model: SheetModel, sheetIndex: number, name: string): SheetModel {
  const old = model.sheets[sheetIndex].name;
  return {
    ...model,
    sheets: model.sheets.map((sheet, position) => {
      const cells: Record<string, SheetCell> = {};
      for (const [key, cell] of Object.entries(sheet.cells))
        cells[key] = cell.v.startsWith("=")
          ? { ...cell, v: `=${renameSheetReferences(cell.v.slice(1), old, name)}` }
          : cell;
      return position === sheetIndex ? { ...sheet, name, cells } : { ...sheet, cells };
    }),
    ...(model.names
      ? { names: model.names.map((entry) => (entry.sheet === old ? { ...entry, sheet: name } : entry)) }
      : {}),
  };
}

export function duplicateSheet(model: SheetModel, sheetIndex: number, name: string): SheetModel {
  const source = model.sheets[sheetIndex];
  const copy: Sheet = { ...structuredClone(source), id: newId(), name };
  // Kopierte Kommentare sind eigene Kommentare (eigene Nummer), sonst wären sie zweimal dieselben.
  if (copy.comments)
    copy.comments = Object.fromEntries(
      Object.entries(copy.comments).map(([key, thread]) => [
        key,
        { ...thread, id: newId(), replies: thread.replies.map((reply) => ({ ...reply, id: newId() })) },
      ]),
    );
  const sheets = [...model.sheets];
  sheets.splice(sheetIndex + 1, 0, copy);
  return { ...model, sheets };
}

// Zellen eines Bereichs übertragen (Kopieren/Ausfüllen): Formeln wandern relativ mit.
export function shiftedCell(cell: SheetCell | undefined, dCol: number, dRow: number): SheetCell | null {
  if (!cell) return null;
  return cell.v.startsWith("=") ? { ...cell, v: `=${shiftFormula(cell.v.slice(1), dCol, dRow)}` } : cell;
}

// Zeilen eines Bereichs nach einer Spalte sortieren (Zahlen vor Text, leere Zellen zuletzt).
export function sortArea(
  sheet: Sheet,
  area: Area,
  column: number,
  direction: 1 | -1,
  value: (col: number, row: number) => unknown,
): Sheet {
  const rows = [];
  for (let row = area.r1; row <= area.r2; row += 1) rows.push(row);
  const sortKey = (row: number) => value(column, row);
  const order = [...rows].sort((a, b) => {
    const left = sortKey(a);
    const right = sortKey(b);
    const empty = (item: unknown) => item === null || item === "";
    if (empty(left) && empty(right)) return a - b;
    if (empty(left)) return 1;
    if (empty(right)) return -1;
    if (typeof left === "number" && typeof right === "number") return (left - right) * direction || a - b;
    if (typeof left === "number") return -1 * direction;
    if (typeof right === "number") return 1 * direction;
    return (
      String(left).localeCompare(String(right), "de-CH", { numeric: true, sensitivity: "base" }) * direction || a - b
    );
  });
  const cells = { ...sheet.cells };
  const snapshot = new Map<string, SheetCell | undefined>();
  for (const row of rows)
    for (let col = area.c1; col <= area.c2; col += 1) snapshot.set(cellKey(col, row), sheet.cells[cellKey(col, row)]);
  order.forEach((sourceRow, offset) => {
    const targetRow = area.r1 + offset;
    for (let col = area.c1; col <= area.c2; col += 1) {
      const moved = shiftedCell(snapshot.get(cellKey(col, sourceRow)), 0, targetRow - sourceRow);
      putCell(cells, cellKey(col, targetRow), moved);
    }
  });
  if (!sheet.comments) return { ...sheet, cells };
  // Kommentare wandern mit ihrer Zeile (wie in Excel).
  const targetOf = new Map(order.map((sourceRow, offset) => [sourceRow, area.r1 + offset]));
  return {
    ...sheet,
    cells,
    comments: moveComments(sheet.comments, (col, row) =>
      inArea(area, col, row) ? cellKey(col, targetOf.get(row) ?? row) : cellKey(col, row),
    ),
  };
}

// Text aus der Zwischenablage (Tabulator-getrennt, wie Excel kopiert) in Zeilen und Zellen zerlegen.
export function parseClipboard(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/\r\n?/g, "\n").replace(/\n$/, "");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell === "") quoted = true;
    else if (char === "\t") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

export function toDelimited(rows: string[][], separator: "\t" | ";") {
  return rows
    .map((row) => row.map((cell) => (/["\n\t;]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join(separator))
    .join(separator === "\t" ? "\n" : "\r\n");
}
