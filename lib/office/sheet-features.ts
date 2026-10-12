// Zusatzfunktionen der Tabelle wie in Excel: Rahmen, bedingte Formatierung, Filter, Datenüberprüfung,
// Diagramm-Daten, Suchen und Ersetzen, Ausfüllen von Reihen und Bezugsarten (F4).
// Alles ohne Browser – Editor, Druck, Export und Tests nutzen dieselben Regeln.
import { cellKey, columnIndex, columnName, isError, parseArea, parseInput, type Area, type Value } from "./formula";
import type { BorderWeight, CellStyle, RuleOp, RuleStyle, Sheet, SheetChart } from "./model";

const inside = (area: Area, col: number, row: number) =>
  col >= area.c1 && col <= area.c2 && row >= area.r1 && row <= area.r2;

// ---------- Rahmen ----------

export const BORDER_WIDTH: Record<BorderWeight, number> = { thin: 1, medium: 2, thick: 3 };
export const DEFAULT_BORDER_COLOR = "#6b7c8f";
export type Edge = { width: number; color: string } | null;
export type Edges = { top: Edge; right: Edge; bottom: Edge; left: Edge };

export function sidesOf(style: CellStyle | undefined) {
  return {
    top: Boolean(style?.border || style?.bt),
    right: Boolean(style?.border || style?.br),
    bottom: Boolean(style?.border || style?.bb),
    left: Boolean(style?.border || style?.bl),
  };
}
const edgeOf = (style: CellStyle | undefined): Edge => ({
  width: BORDER_WIDTH[style?.bw ?? "thin"],
  color: style?.bc ?? DEFAULT_BORDER_COLOR,
});

// Sichtbare Rahmenlinien einer Zelle. Eine Linie zwischen zwei Zellen wird nur einmal gezeichnet: oben und links
// nur, wenn die Nachbarzelle sie nicht schon unten bzw. rechts zeichnet.
export function edgesAt(sheet: Sheet, col: number, row: number): Edges | null {
  const style = sheet.cells[cellKey(col, row)]?.s;
  const own = sidesOf(style);
  const above = row > 0 ? sheet.cells[cellKey(col, row - 1)]?.s : undefined;
  const before = col > 0 ? sheet.cells[cellKey(col - 1, row)]?.s : undefined;
  const right = sheet.cells[cellKey(col + 1, row)]?.s;
  const below = sheet.cells[cellKey(col, row + 1)]?.s;
  const aboveDraws = sidesOf(above).bottom;
  const beforeDraws = sidesOf(before).right;
  const edges: Edges = {
    top: own.top && !aboveDraws ? edgeOf(style) : null,
    left: own.left && !beforeDraws ? edgeOf(style) : null,
    bottom: own.bottom ? edgeOf(style) : sidesOf(below).top ? edgeOf(below) : null,
    right: own.right ? edgeOf(style) : sidesOf(right).left ? edgeOf(right) : null,
  };
  return edges.top || edges.left || edges.bottom || edges.right ? edges : null;
}

// Rahmen auf einen Bereich anwenden (wie das Rahmen-Menü in Excel).
export type BorderPreset = "all" | "outside" | "inside" | "top" | "bottom" | "left" | "right" | "none" | "thickOutside";
export function applyBorder(
  style: CellStyle,
  preset: BorderPreset,
  area: Area,
  col: number,
  row: number,
  weight: BorderWeight,
  color: string | null,
): CellStyle {
  const next: CellStyle = { ...style };
  const set = (side: "bt" | "bb" | "bl" | "br", on: boolean) => {
    if (on) next[side] = true;
  };
  const top = row === area.r1;
  const bottom = row === area.r2;
  const left = col === area.c1;
  const right = col === area.c2;
  // Bisheriges „alle Seiten“ in einzelne Seiten auflösen, damit gezielt geändert werden kann.
  if (next.border) {
    next.bt = next.bb = next.bl = next.br = true;
    delete next.border;
  }
  switch (preset) {
    case "none":
      delete next.bt;
      delete next.bb;
      delete next.bl;
      delete next.br;
      delete next.bw;
      delete next.bc;
      return next;
    case "all":
      next.bt = next.bb = next.bl = next.br = true;
      break;
    case "outside":
    case "thickOutside":
      set("bt", top);
      set("bb", bottom);
      set("bl", left);
      set("br", right);
      break;
    case "inside":
      set("bb", !bottom);
      set("br", !right);
      break;
    case "top":
      set("bt", top);
      break;
    case "bottom":
      set("bb", bottom);
      break;
    case "left":
      set("bl", left);
      break;
    case "right":
      set("br", right);
      break;
  }
  const finalWeight = preset === "thickOutside" ? "thick" : weight;
  if (next.bt || next.bb || next.bl || next.br) {
    if (finalWeight === "thin") delete next.bw;
    else next.bw = finalWeight;
    if (color && color !== DEFAULT_BORDER_COLOR) next.bc = color;
    else delete next.bc;
  }
  if (next.bt && next.bb && next.bl && next.br) {
    next.border = true;
    delete next.bt;
    delete next.bb;
    delete next.bl;
    delete next.br;
  }
  return next;
}

// ---------- Zellenformatvorlagen (wie „Zellenformatvorlagen“ in Excel) ----------

export const CELL_STYLES: { id: string; label: string; style: CellStyle }[] = [
  { id: "standard", label: "Standard", style: {} },
  { id: "gut", label: "Gut", style: { fill: "#c6efce", color: "#006100" } },
  { id: "schlecht", label: "Schlecht", style: { fill: "#ffc7ce", color: "#9c0006" } },
  { id: "neutral", label: "Neutral", style: { fill: "#ffeb9c", color: "#9c5700" } },
  { id: "titel", label: "Titel", style: { b: true, size: 18, color: "#1f3864" } },
  {
    id: "ueberschrift1",
    label: "Überschrift 1",
    style: { b: true, size: 15, color: "#1f3864", bb: true, bw: "thick", bc: "#4472c4" },
  },
  {
    id: "ueberschrift2",
    label: "Überschrift 2",
    style: { b: true, size: 13, color: "#1f3864", bb: true, bw: "medium", bc: "#a9bce3" },
  },
  { id: "ergebnis", label: "Ergebnis", style: { b: true, bt: true, bb: true, bw: "medium", bc: "#4472c4" } },
  { id: "eingabe", label: "Eingabe", style: { fill: "#ffcc99", color: "#3f3f76", border: true, bc: "#7f7f7f" } },
  {
    id: "berechnung",
    label: "Berechnung",
    style: { fill: "#f2f2f2", color: "#fa7d00", b: true, border: true, bc: "#7f7f7f" },
  },
  { id: "notiz", label: "Notiz", style: { fill: "#ffffcc", border: true, bc: "#b2b2b2" } },
  { id: "warnung", label: "Warnhinweis", style: { color: "#ff0000" } },
];
// Formatvorlage übernehmen: Zahlenformat und Ausrichtung der Zelle bleiben, Schrift, Farben und Rahmen wechseln.
export function withCellStyle(style: CellStyle, preset: CellStyle): CellStyle {
  const keep: CellStyle = {
    ...(style.fmt ? { fmt: style.fmt } : {}),
    ...(style.dec !== undefined ? { dec: style.dec } : {}),
    ...(style.align ? { align: style.align } : {}),
    ...(style.valign ? { valign: style.valign } : {}),
    ...(style.wrap ? { wrap: true } : {}),
    ...(style.indent ? { indent: style.indent } : {}),
  };
  return { ...keep, ...preset };
}

// ---------- Werte vergleichen ----------

function asNumber(value: Value | string): number | null {
  if (typeof value === "number") return value;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = parseInput(value.trim());
  return parsed.type === "number" ? parsed.value : null;
}
const asText = (value: Value) =>
  value === null ? "" : typeof value === "boolean" ? (value ? "WAHR" : "FALSCH") : isError(value) ? "" : String(value);

// ---------- Bedingte Formatierung ----------

export const RULE_LABELS: Record<RuleOp, string> = {
  gt: "Grösser als",
  lt: "Kleiner als",
  ge: "Grösser oder gleich",
  le: "Kleiner oder gleich",
  eq: "Gleich",
  ne: "Ungleich",
  between: "Zwischen",
  contains: "Text enthält",
  empty: "Ist leer",
  notEmpty: "Ist nicht leer",
  duplicate: "Doppelte Werte",
  scale: "Farbskala",
  bar: "Datenbalken",
};
export const RULE_NEEDS: Record<RuleOp, 0 | 1 | 2> = {
  gt: 1,
  lt: 1,
  ge: 1,
  le: 1,
  eq: 1,
  ne: 1,
  between: 2,
  contains: 1,
  empty: 0,
  notEmpty: 0,
  duplicate: 0,
  scale: 0,
  bar: 0,
};
// Farben wie die Standard-Vorlagen in Excel (kleinster, mittlerer, grösster Wert).
export const SCALE_PRESETS: { id: string; label: string; colors: string[] }[] = [
  { id: "gruenGelbRot", label: "Grün – Gelb – Rot (hoch ist gut)", colors: ["#f8696b", "#ffeb84", "#63be7b"] },
  { id: "rotGelbGruen", label: "Rot – Gelb – Grün (tief ist gut)", colors: ["#63be7b", "#ffeb84", "#f8696b"] },
  { id: "weissGruen", label: "Weiss – Grün", colors: ["#ffffff", "#63be7b"] },
  { id: "weissRot", label: "Weiss – Rot", colors: ["#ffffff", "#f8696b"] },
];
export const BAR_PRESETS: { id: string; label: string; colors: string[] }[] = [
  { id: "blau", label: "Blau", colors: ["#638ec6"] },
  { id: "gruen", label: "Grün", colors: ["#63c384"] },
  { id: "rot", label: "Rot", colors: ["#ff555a"] },
  { id: "orange", label: "Orange", colors: ["#ffb628"] },
];
export const RULE_PRESETS: { id: string; label: string; style: RuleStyle }[] = [
  { id: "rot", label: "Hellrote Füllung, dunkelroter Text", style: { fill: "#ffc7ce", color: "#9c0006" } },
  { id: "gelb", label: "Gelbe Füllung, dunkelgelber Text", style: { fill: "#ffeb9c", color: "#9c5700" } },
  { id: "gruen", label: "Grüne Füllung, dunkelgrüner Text", style: { fill: "#c6efce", color: "#006100" } },
  { id: "rotText", label: "Roter Text", style: { color: "#9c0006" } },
  { id: "fett", label: "Fett", style: { b: true } },
];

export function ruleMatches(op: RuleOp, value: Value, a: string, b: string, duplicates?: Set<string>): boolean {
  if (isError(value) || op === "scale" || op === "bar") return false;
  const empty = value === null || value === "";
  if (op === "empty") return empty;
  if (op === "notEmpty") return !empty;
  if (empty) return false;
  if (op === "duplicate") return Boolean(duplicates?.has(asText(value).toLocaleLowerCase("de-CH")));
  if (op === "contains") return asText(value).toLocaleLowerCase("de-CH").includes(a.toLocaleLowerCase("de-CH"));
  const number = asNumber(value);
  const first = asNumber(a);
  if (op === "between") {
    const second = asNumber(b);
    if (number === null || first === null || second === null) return false;
    return number >= Math.min(first, second) && number <= Math.max(first, second);
  }
  let order: number;
  if (number !== null && first !== null) order = number - first;
  else if (op === "eq" || op === "ne") order = asText(value).localeCompare(a, "de-CH", { sensitivity: "base" });
  else return false;
  switch (op) {
    case "gt":
      return order > 0;
    case "lt":
      return order < 0;
    case "ge":
      return order >= 0;
    case "le":
      return order <= 0;
    case "eq":
      return order === 0;
    default:
      return order !== 0;
  }
}

// Darstellung einer Zelle aus allen Regeln: Hervorhebung, Farbe der Farbskala und Länge des Datenbalkens.
export type RuleLook = RuleStyle & { bar?: { size: number; color: string } };

const mix = (from: string, to: string, ratio: number) => {
  const a = parseInt(from.slice(1), 16);
  const b = parseInt(to.slice(1), 16);
  const channel = (shift: number) =>
    Math.round(((a >> shift) & 255) + (((b >> shift) & 255) - ((a >> shift) & 255)) * ratio);
  return `#${[16, 8, 0].map((shift) => channel(shift).toString(16).padStart(2, "0")).join("")}`;
};

// Farbe der Farbskala für einen Wert: zwischen kleinstem und grösstem Wert, bei drei Farben über den Median.
export function scaleColor(colors: string[], value: number, min: number, mid: number, max: number) {
  if (max === min) return colors[colors.length - 1];
  if (colors.length < 3) return mix(colors[0], colors[1] ?? colors[0], (value - min) / (max - min));
  if (value <= mid) return mix(colors[0], colors[1], mid === min ? 1 : (value - min) / (mid - min));
  return mix(colors[1], colors[2], max === mid ? 1 : (value - mid) / (max - mid));
}

// Länge des Datenbalkens wie in Excel: kleinster Wert 10 %, grösster 90 % der Zellbreite.
export const barSize = (value: number, min: number, max: number) =>
  max === min ? 0.9 : 0.1 + (0.8 * (value - min)) / (max - min);

// Regeln eines Blatts vorbereiten; liefert für jede Zelle die Darstellung aus allen zutreffenden Regeln.
export function ruleStyler(sheet: Sheet, valueAt: (col: number, row: number) => Value) {
  const rules = sheet.rules.flatMap((rule) => {
    const area = parseArea(rule.range);
    if (!area) return [];
    let numbers: { min: number; mid: number; max: number } | undefined;
    if (rule.op === "scale" || rule.op === "bar") {
      const list: number[] = [];
      const lastRow = Math.min(area.r2, sheet.rowCount - 1);
      for (let row = area.r1; row <= lastRow; row += 1)
        for (let col = area.c1; col <= area.c2; col += 1) {
          const value = valueAt(col, row);
          if (typeof value === "number") list.push(value);
        }
      if (!list.length) return [];
      list.sort((a, b) => a - b);
      const half = Math.floor(list.length / 2);
      numbers = {
        min: list[0],
        max: list[list.length - 1],
        mid: list.length % 2 ? list[half] : (list[half - 1] + list[half]) / 2,
      };
    }
    let duplicates: Set<string> | undefined;
    if (rule.op === "duplicate") {
      const counts = new Map<string, number>();
      const lastRow = Math.min(area.r2, sheet.rowCount - 1);
      for (let row = area.r1; row <= lastRow; row += 1)
        for (let col = area.c1; col <= area.c2; col += 1) {
          const value = valueAt(col, row);
          if (value === null || value === "" || isError(value)) continue;
          const key = asText(value).toLocaleLowerCase("de-CH");
          counts.set(key, (counts.get(key) ?? 0) + 1);
        }
      duplicates = new Set([...counts].filter(([, count]) => count > 1).map(([key]) => key));
    }
    return [{ rule, area, duplicates, numbers }];
  });
  return (col: number, row: number): RuleLook | undefined => {
    let look: RuleLook | undefined;
    let highlighted = false;
    for (const { rule, area, duplicates, numbers } of rules) {
      if (!inside(area, col, row)) continue;
      const value = valueAt(col, row);
      if (numbers && typeof value === "number") {
        const colors = rule.colors?.length
          ? rule.colors
          : rule.op === "bar"
            ? ["#638ec6"]
            : ["#f8696b", "#ffeb84", "#63be7b"];
        if (rule.op === "scale" && !look?.fill)
          look = { ...look, fill: scaleColor(colors, value, numbers.min, numbers.mid, numbers.max) };
        if (rule.op === "bar" && !look?.bar)
          look = { ...look, bar: { size: barSize(value, numbers.min, numbers.max), color: colors[0] } };
        continue;
      }
      // Die erste zutreffende Hervorhebung gilt (wie bisher), sie geht der Farbskala vor.
      if (!highlighted && ruleMatches(rule.op, value, rule.value, rule.value2, duplicates)) {
        highlighted = true;
        look = { ...look, ...rule.style };
      }
    }
    return look;
  };
}

// ---------- Filter ----------

// Zeilen, die der Filter ausblendet (Kopfzeile des Bereichs bleibt immer sichtbar).
export function filteredRows(sheet: Sheet, text: (col: number, row: number) => string): Set<number> {
  const hidden = new Set<number>();
  if (!sheet.filter) return hidden;
  const area = parseArea(sheet.filter.range);
  if (!area) return hidden;
  const columns = Object.entries(sheet.filter.hidden)
    .map(([col, values]) => ({ col: Number(col), values: new Set(values) }))
    .filter((entry) => entry.values.size && entry.col >= area.c1 && entry.col <= area.c2);
  if (!columns.length) return hidden;
  for (let row = area.r1 + 1; row <= area.r2; row += 1)
    if (columns.some((entry) => entry.values.has(text(entry.col, row)))) hidden.add(row);
  return hidden;
}

// Verschiedene Werte einer Spalte im Filterbereich (für die Auswahlliste im Spaltenkopf), sortiert.
export function distinctValues(sheet: Sheet, col: number, text: (col: number, row: number) => string) {
  const area = sheet.filter ? parseArea(sheet.filter.range) : null;
  if (!area) return [];
  const values = new Set<string>();
  for (let row = area.r1 + 1; row <= area.r2; row += 1) values.add(text(col, row));
  return [...values].sort((a, b) => {
    if (a === "") return 1;
    if (b === "") return -1;
    const x = asNumber(a);
    const y = asNumber(b);
    if (x !== null && y !== null) return x - y;
    return a.localeCompare(b, "de-CH", { numeric: true, sensitivity: "base" });
  });
}

// Zusammenhängender Datenbereich um eine Zelle (für Filter, Sortieren und Diagramme wie in Excel).
export function currentRegion(sheet: Sheet, col: number, row: number): Area {
  const filled = (c: number, r: number) => (sheet.cells[cellKey(c, r)]?.v ?? "") !== "";
  const area = { c1: col, r1: row, c2: col, r2: row };
  let grown = true;
  while (grown) {
    grown = false;
    const touches = (c: number, r: number) =>
      c >= 0 && r >= 0 && c < sheet.colCount && r < sheet.rowCount && filled(c, r);
    for (let r = area.r1 - 1; r <= area.r2 + 1; r += 1) {
      if (touches(area.c1 - 1, r)) {
        area.c1 -= 1;
        grown = true;
      }
      if (touches(area.c2 + 1, r)) {
        area.c2 += 1;
        grown = true;
      }
    }
    for (let c = area.c1 - 1; c <= area.c2 + 1; c += 1) {
      if (touches(c, area.r1 - 1)) {
        area.r1 -= 1;
        grown = true;
      }
      if (touches(c, area.r2 + 1)) {
        area.r2 += 1;
        grown = true;
      }
    }
  }
  return area;
}

// ---------- Datenüberprüfung (Auswahlliste) ----------

export function validationAt(sheet: Sheet, col: number, row: number) {
  for (const item of sheet.validations) {
    const area = parseArea(item.range);
    if (area && inside(area, col, row)) return item;
  }
  return null;
}
export function allowedByValidation(values: string[], raw: string) {
  if (raw === "") return true;
  const lower = raw.trim().toLocaleLowerCase("de-CH");
  return values.find((value) => value.toLocaleLowerCase("de-CH") === lower) ?? false;
}

// ---------- Diagramme ----------

export const CHART_LABELS: Record<SheetChart["type"], string> = {
  column: "Säulen",
  bar: "Balken",
  line: "Linie",
  pie: "Kreis",
};
export type ChartData = {
  categories: string[];
  series: { name: string; col: number; values: number[] }[];
  // Aufbau des Bereichs (für die Bezüge in der Excel-Datei).
  layout: { headerRow: boolean; labelCol: boolean; firstRow: number; firstCol: number };
};

// Erste Zeile mit Text = Reihennamen, erste Spalte mit Text = Rubriken (wie Excel beim Einfügen eines Diagramms).
export function chartData(
  area: Area,
  valueAt: (col: number, row: number) => Value,
  text: (col: number, row: number) => string,
): ChartData {
  const isLabel = (value: Value) => typeof value === "string" || value === null;
  let headerRow = true;
  for (let col = area.c1; col <= area.c2; col += 1) if (!isLabel(valueAt(col, area.r1))) headerRow = false;
  if (area.r1 === area.r2) headerRow = false;
  let labelCol = true;
  for (let row = area.r1 + (headerRow ? 1 : 0); row <= area.r2; row += 1)
    if (!isLabel(valueAt(area.c1, row))) labelCol = false;
  if (area.c1 === area.c2) labelCol = false;
  const firstRow = area.r1 + (headerRow ? 1 : 0);
  const firstCol = area.c1 + (labelCol ? 1 : 0);
  const categories: string[] = [];
  for (let row = firstRow; row <= area.r2; row += 1)
    categories.push(labelCol ? text(area.c1, row) : String(row - firstRow + 1));
  const series: ChartData["series"] = [];
  for (let col = firstCol; col <= area.c2; col += 1) {
    const values: number[] = [];
    let numeric = false;
    for (let row = firstRow; row <= area.r2; row += 1) {
      const value = valueAt(col, row);
      if (typeof value === "number") numeric = true;
      values.push(typeof value === "number" ? value : 0);
    }
    // Spalten ganz ohne Zahlen (z. B. Text) sind keine Datenreihe.
    if (!numeric) continue;
    const name = headerRow ? text(col, area.r1) : "";
    series.push({ name: name || `Reihe ${series.length + 1}`, col, values });
  }
  return { categories, series, layout: { headerRow, labelCol, firstRow, firstCol } };
}
export const CHART_COLORS = ["#2563eb", "#0f766e", "#f97316", "#7c3aed", "#be185d", "#a16207", "#15803d", "#5b6b6d"];

// ---------- Suchen und Ersetzen ----------

export type FindOptions = { matchCase: boolean; wholeCell: boolean };
export function cellMatches(content: string, query: string, options: FindOptions) {
  if (!query) return false;
  const a = options.matchCase ? content : content.toLocaleLowerCase("de-CH");
  const b = options.matchCase ? query : query.toLocaleLowerCase("de-CH");
  return options.wholeCell ? a === b : a.includes(b);
}
export function replaceIn(content: string, query: string, replacement: string, options: FindOptions) {
  if (options.wholeCell) return cellMatches(content, query, options) ? replacement : content;
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return content.replace(new RegExp(escaped, options.matchCase ? "g" : "gi"), () => replacement);
}
// Alle Treffer eines Blatts zeilenweise (wie Excel „Zeilenweise“ sucht).
export function findAll(
  sheet: Sheet,
  query: string,
  options: FindOptions,
  display: (col: number, row: number) => string,
) {
  const hits: { col: number; row: number }[] = [];
  if (!query) return hits;
  for (const key of Object.keys(sheet.cells)) {
    const match = /^([A-Z]+)(\d+)$/.exec(key);
    if (!match) continue;
    const col = columnIndex(match[1]);
    const row = Number(match[2]) - 1;
    const raw = sheet.cells[key].v;
    if (cellMatches(raw, query, options) || (raw.startsWith("=") && cellMatches(display(col, row), query, options)))
      hits.push({ col, row });
  }
  return hits.sort((a, b) => a.row - b.row || a.col - b.col);
}

// ---------- Ausfüllen von Reihen ----------

const SERIES = [
  ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"],
  ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"],
  [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ],
  ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"],
  ["Quartal 1", "Quartal 2", "Quartal 3", "Quartal 4"],
];

// Nächster Wert einer Textreihe: Wochentage, Monate oder Text mit Zahl am Ende („Woche 1“ → „Woche 2“).
// null = keine Reihe erkannt (dann wird einfach wiederholt).
export function seriesValue(seeds: string[], offset: number): string | null {
  if (!seeds.length || seeds.some((seed) => seed === "" || seed.startsWith("="))) return null;
  for (const list of SERIES) {
    const lower = list.map((item) => item.toLocaleLowerCase("de-CH"));
    const positions = seeds.map((seed) => lower.indexOf(seed.toLocaleLowerCase("de-CH")));
    if (positions.some((position) => position < 0)) continue;
    const step = positions.length > 1 ? positions[1] - positions[0] : 1;
    if (positions.some((position, index) => index > 0 && position - positions[index - 1] !== step)) continue;
    const at = (((positions[0] + step * offset) % list.length) + list.length) % list.length;
    const word = list[at];
    // Schreibweise des Musters übernehmen (GROSS, klein).
    const sample = seeds[0];
    if (sample === sample.toLocaleUpperCase("de-CH") && sample !== sample.toLocaleLowerCase("de-CH"))
      return word.toLocaleUpperCase("de-CH");
    if (sample === sample.toLocaleLowerCase("de-CH")) return word.toLocaleLowerCase("de-CH");
    return word;
  }
  const parts = seeds.map((seed) => /^(.*?)(\d+)$/.exec(seed));
  if (parts.every((part) => part !== null && part[1] === parts[0]![1] && part[1] !== "")) {
    const numbers = parts.map((part) => Number(part![2]));
    const step = numbers.length > 1 ? numbers[1] - numbers[0] : 1;
    if (numbers.some((number, index) => index > 0 && number - numbers[index - 1] !== step)) return null;
    const next = numbers[0] + step * offset;
    if (next < 0) return null;
    const digits = parts[0]![2].length;
    return `${parts[0]![1]}${String(next).padStart(parts[0]![2].startsWith("0") ? digits : 1, "0")}`;
  }
  return null;
}

// ---------- Bezugsart wechseln (F4) ----------

// A1 → $A$1 → A$1 → $A1 → A1 für den Bezug an der Schreibmarke. Liefert neuen Text und neue Schreibmarke.
export function cycleReference(text: string, caret: number): { text: string; caret: number } | null {
  const pattern = /(\$?)([A-Za-z]{1,3})(\$?)(\d{1,6})(?![\w(])/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const start = match.index;
    const end = start + match[0].length;
    const before = text[start - 1] ?? "";
    if (/[A-Za-zÄÖÜäöü0-9_.]/.test(before)) continue;
    if (caret < start || caret > end) continue;
    const [, absCol, col, absRow, row] = match;
    const state = (absCol ? 2 : 0) + (absRow ? 1 : 0);
    // Reihenfolge wie Excel: relativ → absolut → Zeile absolut → Spalte absolut → relativ.
    const next = { 0: "$C$R", 3: "C$R", 1: "$CR", 2: "CR" }[state as 0 | 1 | 2 | 3]!;
    const replacement = next.replace("C", col.toUpperCase()).replace("R", row);
    return { text: text.slice(0, start) + replacement + text.slice(end), caret: start + replacement.length };
  }
  return null;
}

// ---------- Bereiche beim Einfügen/Löschen von Zeilen und Spalten ----------

export function shiftArea(area: Area, axis: "row" | "col", index: number, count: number): Area | null {
  const lo = axis === "row" ? area.r1 : area.c1;
  const hi = axis === "row" ? area.r2 : area.c2;
  let a = lo;
  let b = hi;
  if (count > 0) {
    if (lo >= index) a += count;
    if (hi >= index) b += count;
  } else {
    const removed = -count;
    const last = index + removed - 1;
    if (lo >= index && hi <= last) return null;
    a = lo > last ? lo - removed : lo >= index ? index : lo;
    b = hi > last ? hi - removed : hi >= index ? index - 1 : hi;
  }
  return axis === "row" ? { ...area, r1: a, r2: b } : { ...area, c1: a, c2: b };
}
export function shiftRangeText(range: string, axis: "row" | "col", index: number, count: number): string | null {
  const area = parseArea(range);
  const next = area ? shiftArea(area, axis, index, count) : null;
  if (!next) return null;
  const single = !range.includes(":");
  const start = `${columnName(next.c1)}${next.r1 + 1}`;
  return single && next.c1 === next.c2 && next.r1 === next.r2 ? start : `${start}:${columnName(next.c2)}${next.r2 + 1}`;
}
