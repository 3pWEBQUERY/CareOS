// Office-Dokumente der Ablage (Dokument, Tabelle, Präsentation): Inhalte, wie sie Editor und Server austauschen.
// Gespeichert wird immer eine echte .docx/.xlsx/.pptx-Datei; dieses Modell steckt zusätzlich darin, damit beim
// erneuten Öffnen nichts verloren geht.
import { COMMENT_LIMITS, cleanThread, cleanThreads, type CommentThread } from "./comments";
import {
  ERROR_LABELS,
  cellKey,
  evaluateCell,
  mayReturnArray,
  isError,
  parseCellKey,
  parseFormula,
  parseInput,
  serialDate,
  type Area,
  type Expr,
  type Value,
  parseArea,
} from "./formula";
import { filteredRows } from "./sheet-features";

export type OfficeKind = "document" | "sheet" | "deck";

export const OFFICE_TYPES = {
  document: {
    label: "Dokument",
    extension: "docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  sheet: {
    label: "Tabelle",
    extension: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  deck: {
    label: "Präsentation",
    extension: "pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  },
} as const;

export function officeKindOf(name: string): OfficeKind | null {
  const extension = name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  if (extension === "docx") return "document";
  if (extension === "xlsx") return "sheet";
  if (extension === "pptx") return "deck";
  return null;
}

// ---------- Dokument ----------

export type DocMark = { type: string; attrs?: Record<string, unknown> };
export type DocNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: DocNode[];
  text?: string;
  marks?: DocMark[];
};
export type PageSetup = {
  orientation: "portrait" | "landscape";
  margins: "narrow" | "normal" | "wide";
  header: string;
  footer: string;
  pageNumbers: boolean;
};
// Kommentare: im Dokument an Textstellen (Markierung „comment“), in der Tabelle je Zelle, in der Präsentation je Folie.
// Änderungen nachverfolgen: „track“ schaltet das Nachverfolgen ein (Markierungen „insertion“ und „deletion“ im Text).
export type DocumentModel = {
  kind: "document";
  page: PageSetup;
  content: DocNode;
  comments?: CommentThread[];
  track?: boolean;
};

export const DEFAULT_PAGE: PageSetup = {
  orientation: "portrait",
  margins: "normal",
  header: "",
  footer: "",
  pageNumbers: true,
};
// Seitenränder in Millimetern (wie in Word: schmal, normal, breit).
export const MARGINS_MM = { narrow: 12.7, normal: 25, wide: 38 } as const;

// ---------- Tabelle ----------

export type NumberFormat =
  "general" | "number" | "integer" | "percent" | "chf" | "eur" | "date" | "time" | "datetime" | "text";
export type CellStyle = {
  b?: boolean;
  i?: boolean;
  u?: boolean;
  s?: boolean;
  color?: string;
  fill?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  fmt?: NumberFormat;
  dec?: number;
  size?: number;
  // Rahmen: „border“ = alle Seiten; bt/bb/bl/br = einzelne Seiten; Stärke und Farbe gelten für alle Seiten.
  border?: boolean;
  bt?: boolean;
  bb?: boolean;
  bl?: boolean;
  br?: boolean;
  bw?: BorderWeight;
  bc?: string;
  font?: string;
  indent?: number;
  // Blattschutz: Zelle bleibt bearbeitbar, wenn das Blatt geschützt ist (wie „Gesperrt“ ausschalten in Excel).
  unlocked?: boolean;
};
export type BorderWeight = "thin" | "medium" | "thick";
export type SheetCell = { v: string; s?: CellStyle };

// Bedingte Formatierung (wie „Regeln zum Hervorheben von Zellen“ in Excel).
export type RuleOp =
  | "gt"
  | "lt"
  | "ge"
  | "le"
  | "eq"
  | "ne"
  | "between"
  | "contains"
  | "empty"
  | "notEmpty"
  | "duplicate"
  | "scale"
  | "bar";
export type RuleStyle = { fill?: string; color?: string; b?: boolean };
// Farbskala: Farben für kleinsten, (mittleren,) grössten Wert; Datenbalken: eine Farbe.
export type SheetRule = {
  id: string;
  range: string;
  op: RuleOp;
  value: string;
  value2: string;
  style: RuleStyle;
  colors?: string[];
};
export type ChartType = "column" | "bar" | "line" | "pie";
export type SheetChart = {
  id: string;
  type: ChartType;
  range: string;
  title: string;
  x: number;
  y: number;
  w: number;
  h: number;
  // Achsentitel und Werte an den Säulen/Punkten (Datenbeschriftungen).
  xTitle?: string;
  yTitle?: string;
  labels?: boolean;
};
export type SheetFilter = { range: string; hidden: Record<string, string[]> };
export type PrintSetup = {
  orientation: "portrait" | "landscape";
  fit: boolean;
  gridlines: boolean;
  // Druckbereich („A1:F40“) sowie Kopf- und Fusszeile jeder Seite.
  area?: string;
  header?: string;
  footer?: string;
  pageNumbers?: boolean;
};
export type Sheet = {
  id: string;
  name: string;
  cells: Record<string, SheetCell>;
  cols: Record<string, number>;
  rows: Record<string, number>;
  merges: string[];
  freeze: { rows: number; cols: number };
  rowCount: number;
  colCount: number;
  hiddenRows: number[];
  hiddenCols: number[];
  filter: SheetFilter | null;
  validations: { range: string; values: string[] }[];
  rules: SheetRule[];
  charts: SheetChart[];
  print: PrintSetup;
  showGrid: boolean;
  comments?: Record<string, CommentThread>;
  // Blattschutz: gesperrte Zellen, Formate und der Aufbau des Blatts lassen sich nicht ändern.
  protected?: boolean;
  // Pivot-Tabelle: das Blatt zeigt die Auswertung eines Bereichs (nur über „Aktualisieren“ geändert).
  pivot?: SheetPivot;
};
export const PIVOT_FUNCTIONS = {
  sum: "Summe",
  count: "Anzahl",
  average: "Mittelwert",
  min: "Minimum",
  max: "Maximum",
} as const;
export type PivotFunction = keyof typeof PIVOT_FUNCTIONS;
// Quelle: Blatt (Kennung, übersteht Umbenennen) und Bereich mit Überschriften in der ersten Zeile; Felder als
// Spalte innerhalb des Bereichs (0 = erste Spalte).
export type SheetPivot = {
  source: string;
  range: string;
  rows: number;
  cols: number | null;
  value: number;
  fn: PivotFunction;
};
// Benannter Bereich der Arbeitsmappe („Plätze“ → Tabelle1!B2:B20), in Formeln wie ein Bezug nutzbar.
export type SheetName = { name: string; sheet: string; range: string };
export type SheetModel = { kind: "sheet"; sheets: Sheet[]; names?: SheetName[] };

export const DEFAULT_COL_WIDTH = 100;
export const DEFAULT_ROW_HEIGHT = 24;

export const FONT_NAMES = ["Calibri", "Arial", "Cambria", "Georgia", "Times New Roman", "Verdana", "Courier New"];

export const NUMBER_FORMATS: { value: NumberFormat; label: string }[] = [
  { value: "general", label: "Standard" },
  { value: "number", label: "Zahl" },
  { value: "integer", label: "Ganze Zahl" },
  { value: "percent", label: "Prozent" },
  { value: "chf", label: "Währung CHF" },
  { value: "eur", label: "Währung EUR" },
  { value: "date", label: "Datum" },
  { value: "time", label: "Uhrzeit" },
  { value: "datetime", label: "Datum und Uhrzeit" },
  { value: "text", label: "Text" },
];

const DEFAULT_DECIMALS: Partial<Record<NumberFormat, number>> = { number: 2, integer: 0, percent: 0, chf: 2, eur: 2 };
export const decimalsOf = (style: CellStyle | undefined) =>
  style?.dec ?? DEFAULT_DECIMALS[style?.fmt ?? "general"] ?? 2;

const pad = (value: number) => String(value).padStart(2, "0");

// Anzeige eines Wertes wie in Excel mit Schweizer Schreibweise (1’250.50, 04.10.2026).
export function formatValue(value: Value, style?: CellStyle): string {
  if (value === null) return "";
  if (isError(value)) return ERROR_LABELS[value.error];
  if (typeof value === "boolean") return value ? "WAHR" : "FALSCH";
  if (typeof value === "string") return value;
  const fmt = style?.fmt ?? "general";
  const decimals = decimalsOf(style);
  // Schweizer Tausendertrennzeichen (’) unabhängig davon, was der Browser liefert.
  const number = (digits: number, input = value) =>
    new Intl.NumberFormat("de-CH", { minimumFractionDigits: digits, maximumFractionDigits: digits })
      .format(input)
      .replace(/['’\u2009\u202f]/g, "’");
  switch (fmt) {
    case "number":
    case "integer":
      return number(fmt === "integer" ? 0 : decimals);
    case "percent":
      return `${number(decimals, value * 100)}%`;
    case "chf":
      return `CHF ${number(decimals)}`;
    case "eur":
      return `${number(decimals)} €`;
    case "date":
    case "datetime": {
      const date = serialDate(value);
      const text = `${pad(date.day)}.${pad(date.month)}.${date.year}`;
      if (fmt === "date") return text;
      const minutes = Math.round((value - Math.floor(value)) * 1440);
      return `${text} ${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
    }
    case "time": {
      const minutes = Math.round((value - Math.floor(value)) * 1440);
      return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
    }
    case "text":
      return String(value);
    default: {
      if (style?.dec !== undefined) return number(style.dec);
      if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
      const precise = Number(value.toPrecision(10));
      return Math.abs(precise) >= 1e11 || (Math.abs(precise) < 1e-6 && precise !== 0)
        ? precise.toExponential(4)
        : String(precise);
    }
  }
}

// Bereich, in den das Ergebnis einer Formel überläuft (FILTERN, SORTIEREN, A1:A5*2 …).
export type Spill = { anchor: string; area: Area; values: Value[][] };

// Alle Formeln einer Arbeitsmappe berechnen (mit Zwischenspeicher, Erkennung von Zirkelbezügen und Überlaufen
// von Bereichs-Ergebnissen in leere Nachbarzellen).
export function evaluateWorkbook(model: SheetModel, options: { today?: () => number } = {}) {
  const parsed = new Map<string, Expr | Error>();
  let results = model.sheets.map(() => new Map<string, Value>());
  const grids = new Map<string, Value[][]>();
  const visiting = new Set<string>();
  const byName = new Map(model.sheets.map((sheet, index) => [sheet.name.toLocaleLowerCase("de-CH"), index]));
  // Benannte Bereiche (Gross-/Kleinschreibung egal, wie in Excel).
  const defined = new Map(
    (model.names ?? []).flatMap((entry) => {
      const area = parseArea(entry.range);
      return area ? [[entry.name.toUpperCase(), { sheet: entry.sheet, area }] as const] : [];
    }),
  );
  const rowsUsed = new Map<number, number>();
  // Überlauf: abgedeckte Zellen (Wert und Ursprung) und Ursprünge, deren Bereich nicht frei ist.
  let spillValues = model.sheets.map(() => new Map<string, Value>());
  let spillOwner = model.sheets.map(() => new Map<string, string>());
  let spillList = model.sheets.map(() => new Map<string, Spill>());
  let blocked = new Set<string>();
  let settled = false;
  const usedRows = (index: number) => {
    if (!rowsUsed.has(index)) rowsUsed.set(index, usedRange(model.sheets[index]).rows);
    let rows = rowsUsed.get(index)!;
    for (const spill of spillList[index].values()) rows = Math.max(rows, spill.area.r2 + 1);
    return rows;
  };
  const sheetIndex = (index: number, sheet: string | undefined) =>
    sheet === undefined ? index : byName.get(sheet.toLocaleLowerCase("de-CH"));
  const filtered = new Map<number, Set<number> | null>();
  function filteredOf(index: number) {
    if (!filtered.has(index)) {
      // Während der Berechnung des Filters selbst gilt noch nichts als gefiltert.
      filtered.set(index, null);
      const sheet = model.sheets[index];
      filtered.set(
        index,
        filteredRows(sheet, (col, row) =>
          formatValue(compute(index, cellKey(col, row)), sheet.cells[cellKey(col, row)]?.s),
        ),
      );
    }
    return filtered.get(index);
  }
  function parse(index: number, key: string): Expr | Error | null {
    const cell = model.sheets[index].cells[key];
    if (!cell || !cell.v.startsWith("=") || cell.v.length < 2 || cell.s?.fmt === "text") return null;
    const id = `${index}!${key}`;
    let expr = parsed.get(id);
    if (!expr) {
      try {
        expr = parseFormula(cell.v.slice(1));
      } catch (error) {
        expr = error instanceof Error ? error : new Error("Formel ungültig");
      }
      parsed.set(id, expr);
    }
    return expr;
  }

  function compute(index: number, key: string): Value {
    const cached = results[index].get(key);
    if (cached !== undefined) return cached;
    const cell = model.sheets[index].cells[key];
    if (!cell || cell.v === "") return spillValues[index].get(key) ?? null;
    const input =
      cell.s?.fmt === "text" && !cell.v.startsWith("=") ? { type: "text" as const, value: cell.v } : parseInput(cell.v);
    let value: Value;
    if (input.type === "formula") {
      const id = `${index}!${key}`;
      if (visiting.has(id)) return { error: "#CYCLE!" };
      const expr = parse(index, key);
      if (!expr || expr instanceof Error) value = { error: "#NAME?" };
      else {
        visiting.add(id);
        const result = evaluateCell(expr, {
          hasSheet: (name) => byName.has(name.toLocaleLowerCase("de-CH")),
          cell: (sheet, col, row) => {
            const target = sheetIndex(index, sheet);
            if (target === undefined) return { error: "#REF!" };
            return compute(target, cellKey(col, row));
          },
          raw: (sheet, col, row) => {
            const target = sheetIndex(index, sheet);
            return target === undefined ? "" : (model.sheets[target].cells[cellKey(col, row)]?.v ?? "");
          },
          spill: (sheet, col, row) => {
            const target = sheetIndex(index, sheet);
            if (target === undefined) return null;
            return spillList[target].get(cellKey(col, row))?.area ?? null;
          },
          rowHidden: (sheet, row, manual) => {
            const target = sheetIndex(index, sheet);
            if (target === undefined) return false;
            if (manual && model.sheets[target].hiddenRows.includes(row)) return true;
            return filteredOf(target)?.has(row) ?? false;
          },
          today: options.today,
          name: (name) => defined.get(name.toUpperCase()) ?? null,
          self: parseCellKey(key) ?? undefined,
          rows: (sheet) => {
            const target = sheetIndex(index, sheet);
            return target === undefined ? 0 : usedRows(target);
          },
        });
        visiting.delete(id);
        if (Array.isArray(result)) {
          grids.set(id, result);
          value = blocked.has(id) ? { error: "#SPILL!" } : result[0][0];
        } else value = result;
        if (value === null) value = 0;
      }
    } else if (input.type === "number" || input.type === "boolean") value = input.value;
    else if (input.type === "text") value = input.value;
    else value = null;
    results[index].set(key, value);
    return value;
  }

  // Überläufe bestimmen: alle Formeln, die einen Bereich liefern können, rechnen und ihre Bereiche eintragen –
  // so oft, bis sich nichts mehr ändert (ein Überlauf kann von einem anderen abhängen).
  function settle() {
    if (settled) return;
    settled = true;
    const candidates: { index: number; key: string; col: number; row: number }[] = [];
    model.sheets.forEach((sheet, index) => {
      for (const key of Object.keys(sheet.cells)) {
        const expr = parse(index, key);
        const ref = parseCellKey(key);
        if (expr && !(expr instanceof Error) && ref && mayReturnArray(expr)) candidates.push({ index, key, ...ref });
      }
    });
    if (!candidates.length) return;
    let previous = "";
    for (let round = 0; round < 5; round += 1) {
      results = model.sheets.map(() => new Map<string, Value>());
      grids.clear();
      rowsUsed.clear();
      filtered.clear();
      for (const candidate of candidates) compute(candidate.index, candidate.key);
      const values = model.sheets.map(() => new Map<string, Value>());
      const owner = model.sheets.map(() => new Map<string, string>());
      const list = model.sheets.map(() => new Map<string, Spill>());
      const stopped = new Set<string>();
      for (const { index, key, col, row } of candidates) {
        const id = `${index}!${key}`;
        const grid = grids.get(id);
        if (!grid || (grid.length === 1 && grid[0].length === 1)) continue;
        const sheet = model.sheets[index];
        const area = { c1: col, r1: row, c2: col + (grid[0]?.length ?? 1) - 1, r2: row + grid.length - 1 };
        let free = area.r2 < sheet.rowCount && area.c2 < sheet.colCount;
        for (let r = area.r1; free && r <= area.r2; r += 1)
          for (let c = area.c1; free && c <= area.c2; c += 1) {
            if (r === row && c === col) continue;
            const target = cellKey(c, r);
            if ((sheet.cells[target]?.v ?? "") !== "" || owner[index].has(target)) free = false;
          }
        if (!free) {
          stopped.add(id);
          continue;
        }
        grid.forEach((line, r) =>
          line.forEach((item, c) => {
            const target = cellKey(col + c, row + r);
            if (r === 0 && c === 0) return;
            values[index].set(target, item);
            owner[index].set(target, key);
          }),
        );
        list[index].set(key, { anchor: key, area, values: grid });
      }
      spillValues = values;
      spillOwner = owner;
      spillList = list;
      blocked = stopped;
      const state = JSON.stringify([
        [...stopped],
        list.map((map) => [...map.values()].map((spill) => [spill.anchor, spill.values])),
      ]);
      if (state === previous) break;
      previous = state;
    }
    results = model.sheets.map(() => new Map<string, Value>());
    grids.clear();
    rowsUsed.clear();
    filtered.clear();
  }

  return {
    value(sheetIndex: number, key: string) {
      settle();
      return compute(sheetIndex, key);
    },
    all() {
      settle();
      model.sheets.forEach((sheet, index) => Object.keys(sheet.cells).forEach((key) => compute(index, key)));
      return results;
    },
    // Überlaufbereiche eines Blatts (Ursprung → Bereich und Werte).
    spills(sheetIndex: number) {
      settle();
      return spillList[sheetIndex];
    },
    // Ursprung der Zelle, wenn sie zu einem Überlauf gehört (auch der Ursprung selbst).
    spillAnchor(sheetIndex: number, key: string) {
      settle();
      if (spillList[sheetIndex].has(key)) return key;
      return spillOwner[sheetIndex].get(key) ?? null;
    },
  };
}

// Benutzter Bereich eines Blatts (für Export, Drucken und CSV).
export function usedRange(sheet: Sheet) {
  let cols = 0;
  let rows = 0;
  for (const [key, cell] of Object.entries(sheet.cells)) {
    if (cell.v === "" && !cell.s) continue;
    const ref = parseCellKey(key);
    if (!ref) continue;
    cols = Math.max(cols, ref.col + 1);
    rows = Math.max(rows, ref.row + 1);
  }
  for (const merge of sheet.merges) {
    const end = parseCellKey(merge.split(":")[1] ?? "");
    if (end) {
      cols = Math.max(cols, end.col + 1);
      rows = Math.max(rows, end.row + 1);
    }
  }
  return { cols, rows };
}

// ---------- Präsentation ----------

export type SlideLayout = "title" | "content" | "two" | "image" | "section" | "blank";
// Freie Objekte auf der Folie (wie in PowerPoint): Lage und Grösse in EMU wie die Folie selbst.
export type SlideShape = "rect" | "roundRect" | "ellipse" | "triangle" | "rightArrow" | "line";
export type ChartSeries = { name: string; values: number[] };
export type SlideItem = { id: string; x: number; y: number; w: number; h: number } & (
  | { type: "text"; body: DocNode }
  | { type: "shape"; shape: SlideShape; fill: string; line: string; text: string }
  | { type: "table"; rows: string[][]; header: boolean }
  | { type: "chart"; chart: ChartType; title: string; categories: string[]; series: ChartSeries[] }
);
export type Slide = {
  id: string;
  layout: SlideLayout;
  title: string;
  subtitle: string;
  body: DocNode;
  body2: DocNode;
  image: string;
  notes: string;
  items: SlideItem[];
  comments?: CommentThread[];
  // Übergang beim Einblenden dieser Folie in der Vorführung (wie in PowerPoint).
  transition?: SlideTransition;
};
export const SLIDE_TRANSITIONS = {
  fade: "Verblassen",
  push: "Schieben",
  wipe: "Wischen",
  cover: "Überdecken",
} as const;
export type SlideTransitionType = keyof typeof SLIDE_TRANSITIONS;
// Dauer wie die Stufen in PowerPoint (schnell 0,5 s, mittel 0,75 s, langsam 1 s).
export const TRANSITION_SPEEDS = {
  fast: { label: "Schnell", ms: 500 },
  med: { label: "Mittel", ms: 750 },
  slow: { label: "Langsam", ms: 1000 },
} as const;
export type TransitionSpeed = keyof typeof TRANSITION_SPEEDS;
export type SlideTransition = { type: SlideTransitionType; speed: TransitionSpeed };
export type DeckTheme = "carecore" | "hell" | "dunkel" | "wald" | "sand";
export type DeckModel = { kind: "deck"; theme: DeckTheme; slides: Slide[] };

export const DECK_THEMES: Record<
  DeckTheme,
  { label: string; background: string; text: string; accent: string; muted: string }
> = {
  carecore: { label: "CareOS", background: "#ffffff", text: "#102a43", accent: "#2563eb", muted: "#5f6f86" },
  hell: { label: "Hell", background: "#f7f7f5", text: "#202124", accent: "#2563eb", muted: "#5f6368" },
  dunkel: { label: "Dunkel", background: "#1f2933", text: "#f5f7fa", accent: "#5eead4", muted: "#c3ccd5" },
  wald: { label: "Wald", background: "#eef5ef", text: "#1d3324", accent: "#2f7d4f", muted: "#4d6655" },
  sand: { label: "Sand", background: "#fbf6ee", text: "#3b2f22", accent: "#b45309", muted: "#76634c" },
};

export const SLIDE_SHAPES: { value: SlideShape; label: string }[] = [
  { value: "rect", label: "Rechteck" },
  { value: "roundRect", label: "Abgerundetes Rechteck" },
  { value: "ellipse", label: "Ellipse" },
  { value: "triangle", label: "Dreieck" },
  { value: "rightArrow", label: "Pfeil" },
  { value: "line", label: "Linie" },
];
export const ITEM_TEXT_SIZE = 18;
export const TABLE_TEXT_SIZE = 14;
// Schrift auf farbiger Fläche: hell oder dunkel, je nachdem, was besser lesbar ist.
export function contrastText(fill: string) {
  const value = /^#([0-9a-f]{6})$/i.exec(fill)?.[1];
  if (!value) return "#111827";
  const [r, g, b] = [0, 2, 4].map((at) => parseInt(value.slice(at, at + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.6 ? "#111827" : "#ffffff";
}
export const ITEM_LIMITS = { items: 40, rows: 30, cols: 12, cell: 500, categories: 40, series: 8 };

export const SLIDE_LAYOUTS: { value: SlideLayout; label: string }[] = [
  { value: "title", label: "Titelfolie" },
  { value: "content", label: "Titel und Inhalt" },
  { value: "two", label: "Zwei Inhalte" },
  { value: "image", label: "Titel, Inhalt und Bild" },
  { value: "section", label: "Abschnitt" },
  { value: "blank", label: "Nur Titel" },
];

// ---------- Gemeinsam ----------

export type OfficeModel = DocumentModel | SheetModel | DeckModel;

export const emptyDoc = (): DocNode => ({ type: "doc", content: [{ type: "paragraph" }] });

const text = (value: string, marks?: DocMark[]): DocNode => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const paragraph = (...content: DocNode[]): DocNode =>
  content.length ? { type: "paragraph", content } : { type: "paragraph" };
const heading = (level: number, value: string): DocNode => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const bullets = (...items: string[]): DocNode => ({
  type: "bulletList",
  content: items.map((item) => ({ type: "listItem", content: [item ? paragraph(text(item)) : paragraph()] })),
});
const tasks = (...items: string[]): DocNode => ({
  type: "taskList",
  content: items.map((item) => ({
    type: "taskItem",
    attrs: { checked: false },
    content: [item ? paragraph(text(item)) : paragraph()],
  })),
});
const table = (header: string[], rows: number): DocNode => ({
  type: "table",
  content: [
    { type: "tableRow", content: header.map((cell) => ({ type: "tableHeader", content: [paragraph(text(cell))] })) },
    ...Array.from({ length: rows }, () => ({
      type: "tableRow",
      content: header.map(() => ({ type: "tableCell", content: [paragraph()] })),
    })),
  ],
});
const bold = [{ type: "bold" }];

export type OfficeTemplate = { id: string; kind: OfficeKind; label: string; description: string; name: string };

// Vorlagen: nur Aufbau und Überschriften – Inhalte trägt das Team selbst ein.
export const OFFICE_TEMPLATES: OfficeTemplate[] = [
  {
    id: "document-blank",
    kind: "document",
    label: "Leeres Dokument",
    description: "Weisse Seite im A4-Format",
    name: "Dokument",
  },
  {
    id: "document-minutes",
    kind: "document",
    label: "Protokoll",
    description: "Teamsitzung mit Traktanden, Beschlüssen und Pendenzen",
    name: "Protokoll Teamsitzung",
  },
  {
    id: "document-leaflet",
    kind: "document",
    label: "Merkblatt",
    description: "Information für Team, Bewohnende oder Angehörige",
    name: "Merkblatt",
  },
  {
    id: "document-letter",
    kind: "document",
    label: "Brief",
    description: "Briefvorlage mit Anschrift, Betreff und Grussformel",
    name: "Brief",
  },
  {
    id: "document-checklist",
    kind: "document",
    label: "Checkliste",
    description: "Abhaklisten zum Ausdrucken oder direkt abhaken",
    name: "Checkliste",
  },
  {
    id: "sheet-blank",
    kind: "sheet",
    label: "Leere Tabelle",
    description: "Arbeitsmappe mit einem Blatt",
    name: "Tabelle",
  },
  {
    id: "sheet-inventory",
    kind: "sheet",
    label: "Inventarliste",
    description: "Bestand je Artikel mit Mindestbestand und Nachbestellung",
    name: "Inventarliste",
  },
  {
    id: "sheet-order",
    kind: "sheet",
    label: "Bestellliste",
    description: "Menge × Preis mit Total je Zeile und Gesamtsumme",
    name: "Bestellliste",
  },
  {
    id: "sheet-budget",
    kind: "sheet",
    label: "Kostenübersicht",
    description: "Monate mit Summen je Kategorie und Jahr",
    name: "Kostenübersicht",
  },
  {
    id: "sheet-attendance",
    kind: "sheet",
    label: "Teilnehmerliste",
    description: "Anwesenheit für Schulungen oder Anlässe",
    name: "Teilnehmerliste",
  },
  {
    id: "deck-blank",
    kind: "deck",
    label: "Leere Präsentation",
    description: "Titelfolie im CareOS-Design",
    name: "Präsentation",
  },
  {
    id: "deck-meeting",
    kind: "deck",
    label: "Teamsitzung",
    description: "Traktanden, Rückblick, Themen und nächste Schritte",
    name: "Teamsitzung",
  },
  {
    id: "deck-training",
    kind: "deck",
    label: "Schulung",
    description: "Lernziele, Inhalte, Praxis und Zusammenfassung",
    name: "Schulung",
  },
];

let counter = 0;
export const newId = () =>
  `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function newSheet(name: string, rowCount = 100, colCount = 26): Sheet {
  return {
    id: newId(),
    name,
    cells: {},
    cols: {},
    rows: {},
    merges: [],
    freeze: { rows: 0, cols: 0 },
    rowCount,
    colCount,
    hiddenRows: [],
    hiddenCols: [],
    filter: null,
    validations: [],
    rules: [],
    charts: [],
    // Wie bisher gedruckt: quer, mit Gitternetz, auf Seitenbreite.
    print: { orientation: "landscape", fit: true, gridlines: true },
    showGrid: true,
  };
}

export function newSlide(layout: SlideLayout, title = "", body: string[] = [], subtitle = ""): Slide {
  return {
    id: newId(),
    layout,
    title,
    subtitle,
    body: body.length ? { type: "doc", content: [bullets(...body)] } : emptyDoc(),
    body2: emptyDoc(),
    image: "",
    notes: "",
    items: [],
  };
}

function headerRow(sheet: Sheet, labels: string[], widths: number[] = []) {
  labels.forEach((label, col) => {
    sheet.cells[cellKey(col, 0)] = { v: label, s: { b: true, fill: "#eaf1ff", border: true } };
    if (widths[col]) sheet.cols[String(col)] = widths[col];
  });
  sheet.freeze = { rows: 1, cols: 0 };
}

export function templateModel(templateId: string): OfficeModel {
  switch (templateId) {
    case "document-minutes":
      return {
        kind: "document",
        page: { ...DEFAULT_PAGE },
        content: {
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 1 }, content: [text("Protokoll Teamsitzung")] },
            table(["Datum", "Zeit", "Ort", "Protokoll"], 1),
            heading(2, "Anwesend"),
            paragraph(),
            heading(2, "Entschuldigt"),
            paragraph(),
            heading(2, "Traktanden"),
            {
              type: "orderedList",
              attrs: { start: 1 },
              content: ["Begrüssung und Protokoll der letzten Sitzung", "", ""].map((item) => ({
                type: "listItem",
                content: [item ? paragraph(text(item)) : paragraph()],
              })),
            },
            heading(2, "Beschlüsse"),
            bullets(""),
            heading(2, "Pendenzen"),
            table(["Was", "Wer", "Bis wann"], 3),
            heading(2, "Nächste Sitzung"),
            paragraph(text("Datum: ", bold)),
          ],
        },
      };
    case "document-leaflet":
      return {
        kind: "document",
        page: { ...DEFAULT_PAGE },
        content: {
          type: "doc",
          content: [
            { type: "heading", attrs: { level: 1, textAlign: "center" }, content: [text("Merkblatt")] },
            { type: "paragraph", attrs: { textAlign: "center" }, content: [text("Thema", [{ type: "italic" }])] },
            { type: "horizontalRule" },
            heading(2, "Worum es geht"),
            paragraph(),
            heading(2, "Das Wichtigste in Kürze"),
            bullets("", "", ""),
            heading(2, "Ansprechperson"),
            paragraph(),
          ],
        },
      };
    case "document-letter":
      return {
        kind: "document",
        page: { ...DEFAULT_PAGE, pageNumbers: false },
        content: {
          type: "doc",
          content: [
            paragraph(),
            paragraph(),
            paragraph(),
            paragraph(),
            { type: "paragraph", attrs: { textAlign: "right" }, content: [text("Ort, Datum")] },
            paragraph(),
            paragraph(text("Betreff", bold)),
            paragraph(),
            paragraph(text("Sehr geehrte Damen und Herren")),
            paragraph(),
            paragraph(),
            paragraph(text("Freundliche Grüsse")),
            paragraph(),
            paragraph(),
          ],
        },
      };
    case "document-checklist":
      return {
        kind: "document",
        page: { ...DEFAULT_PAGE },
        content: {
          type: "doc",
          content: [
            heading(1, "Checkliste"),
            paragraph(text("Erledigt von: ", bold)),
            paragraph(text("Datum: ", bold)),
            heading(2, "Vorbereitung"),
            tasks("", "", ""),
            heading(2, "Durchführung"),
            tasks("", "", ""),
            heading(2, "Abschluss"),
            tasks("", ""),
          ],
        },
      };
    case "sheet-inventory": {
      const sheet = newSheet("Inventar");
      headerRow(
        sheet,
        ["Artikel", "Ort", "Einheit", "Bestand", "Mindestbestand", "Nachbestellen"],
        [200, 140, 90, 90, 130, 120],
      );
      for (let row = 1; row <= 30; row += 1) {
        const n = row + 1;
        sheet.cells[cellKey(5, row)] = {
          v: `=WENN(UND(D${n}<>"";D${n}<E${n});"Ja";"")`,
          s: { b: true, color: "#b42318", align: "center" },
        };
      }
      return { kind: "sheet", sheets: [sheet] };
    }
    case "sheet-order": {
      const sheet = newSheet("Bestellung");
      headerRow(sheet, ["Artikel", "Lieferant", "Menge", "Preis", "Total"], [220, 160, 80, 110, 120]);
      for (let row = 1; row <= 20; row += 1) {
        const n = row + 1;
        sheet.cells[cellKey(3, row)] = { v: "", s: { fmt: "chf" } };
        sheet.cells[cellKey(4, row)] = { v: `=WENN(C${n}="";"";C${n}*D${n})`, s: { fmt: "chf" } };
      }
      sheet.cells["D23"] = { v: "Gesamt", s: { b: true, align: "right" } };
      sheet.cells["E23"] = { v: "=SUMME(E2:E21)", s: { b: true, fmt: "chf", border: true, fill: "#eaf1ff" } };
      return { kind: "sheet", sheets: [sheet] };
    }
    case "sheet-budget": {
      const sheet = newSheet("Kosten");
      const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
      headerRow(sheet, ["Kategorie", ...months, "Jahr"], [180, ...months.map(() => 86), 110]);
      for (let row = 1; row <= 10; row += 1) {
        for (let col = 1; col <= 12; col += 1) sheet.cells[cellKey(col, row)] = { v: "", s: { fmt: "number" } };
        sheet.cells[cellKey(13, row)] = { v: `=SUMME(B${row + 1}:M${row + 1})`, s: { b: true, fmt: "number" } };
      }
      sheet.cells["A12"] = { v: "Total", s: { b: true, fill: "#eaf1ff", border: true } };
      for (let col = 1; col <= 13; col += 1) {
        const name = cellKey(col, 0).replace(/\d+$/, "");
        sheet.cells[cellKey(col, 11)] = {
          v: `=SUMME(${name}2:${name}11)`,
          s: { b: true, fmt: "number", fill: "#eaf1ff", border: true },
        };
      }
      sheet.freeze = { rows: 1, cols: 1 };
      return { kind: "sheet", sheets: [sheet] };
    }
    case "sheet-attendance": {
      const sheet = newSheet("Teilnehmende");
      sheet.cells.A1 = { v: "Anlass", s: { b: true, size: 14 } };
      sheet.cells.A2 = { v: "Datum", s: { b: true } };
      sheet.cells.B2 = { v: "", s: { fmt: "date" } };
      ["Name", "Funktion", "Wohnbereich", "Anwesend", "Unterschrift"].forEach((label, col) => {
        sheet.cells[cellKey(col, 3)] = { v: label, s: { b: true, fill: "#eaf1ff", border: true } };
      });
      [200, 150, 150, 100, 200].forEach((width, col) => (sheet.cols[String(col)] = width));
      for (let row = 4; row < 29; row += 1)
        for (let col = 0; col < 5; col += 1)
          sheet.cells[cellKey(col, row)] = { v: "", s: { border: true, ...(col === 3 ? { align: "center" } : {}) } };
      sheet.cells.A31 = { v: "Anwesend", s: { b: true } };
      sheet.cells.B31 = { v: '=ZÄHLENWENN(D5:D29;"Ja")', s: { b: true } };
      sheet.freeze = { rows: 4, cols: 0 };
      return { kind: "sheet", sheets: [sheet] };
    }
    case "deck-meeting":
      return {
        kind: "deck",
        theme: "carecore",
        slides: [
          newSlide("title", "Teamsitzung", [], "Datum und Ort"),
          newSlide("content", "Traktanden", ["Rückblick", "Aktuelle Themen", "Nächste Schritte"]),
          newSlide("content", "Rückblick", [""]),
          newSlide("two", "Aktuelle Themen", [""]),
          newSlide("content", "Nächste Schritte", [""]),
        ],
      };
    case "deck-training":
      return {
        kind: "deck",
        theme: "wald",
        slides: [
          newSlide("title", "Schulung", [], "Thema und Referent/in"),
          newSlide("content", "Lernziele", ["", ""]),
          newSlide("section", "Inhalte"),
          newSlide("content", "Grundlagen", [""]),
          newSlide("image", "In der Praxis", [""]),
          newSlide("content", "Zusammenfassung", [""]),
        ],
      };
    case "sheet-blank":
      return { kind: "sheet", sheets: [newSheet("Tabelle1")] };
    case "deck-blank":
      return { kind: "deck", theme: "carecore", slides: [newSlide("title", "", [], "")] };
    default:
      return { kind: "document", page: { ...DEFAULT_PAGE }, content: emptyDoc() };
  }
}

// ---------- Prüfen (Daten vom Browser) ----------

const COLOR = /^#[0-9a-f]{6}$/i;

// Gültiger Name für einen benannten Bereich (wie in Excel: kein Zellbezug, keine Leerzeichen).
export function nameProblem(name: string): string | null {
  if (!name) return "Bitte einen Namen eingeben.";
  if (name.length > 100) return "Der Name ist zu lang (höchstens 100 Zeichen).";
  if (!/^[A-Za-zÄÖÜäöü_][A-Za-zÄÖÜäöüß0-9_.]*$/.test(name))
    return "Der Name beginnt mit einem Buchstaben und enthält nur Buchstaben, Ziffern, Punkt oder Unterstrich.";
  if (/^[A-Za-z]{1,3}\d+$/.test(name) || /^[RrZz]\d*([CcSs]\d*)?$/.test(name) || /^[CcSs]\d*$/.test(name))
    return "Der Name darf nicht wie ein Zellbezug aussehen.";
  if (/^(wahr|falsch|true|false)$/i.test(name)) return "Dieser Name ist reserviert.";
  return null;
}
const ALLOWED_NODES = new Set([
  "doc",
  "paragraph",
  "heading",
  "text",
  "hardBreak",
  "blockquote",
  "bulletList",
  "orderedList",
  "listItem",
  "taskList",
  "taskItem",
  "table",
  "tableRow",
  "tableHeader",
  "tableCell",
  "horizontalRule",
  "image",
  "pageBreak",
  "tableOfContents",
  "footnote",
]);
const ALLOWED_MARKS = new Set([
  "bold",
  "italic",
  "underline",
  "strike",
  "textStyle",
  "highlight",
  "link",
  "subscript",
  "superscript",
  "comment",
  "insertion",
  "deletion",
]);

function cleanAttrs(attrs: unknown): Record<string, unknown> | undefined {
  if (!attrs || typeof attrs !== "object") return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs as Record<string, unknown>)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "string") out[key] = value.slice(0, key === "src" ? 3_000_000 : 2000);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (Array.isArray(value) && value.every((item) => typeof item === "number")) out[key] = value.slice(0, 50);
  }
  return Object.keys(out).length ? out : undefined;
}

export function cleanDocNode(input: unknown, depth = 0): DocNode | null {
  if (!input || typeof input !== "object" || depth > 40) return null;
  const node = input as Record<string, unknown>;
  const type = String(node.type ?? "");
  if (!ALLOWED_NODES.has(type)) return null;
  const out: DocNode = { type };
  const attrs = cleanAttrs(node.attrs);
  if (attrs) {
    // Bilder nur als eingebettete Daten (keine fremden Adressen).
    if (
      type === "image" &&
      typeof attrs.src === "string" &&
      !/^data:image\/(png|jpeg|gif|webp);base64,/.test(attrs.src)
    )
      return null;
    out.attrs = attrs;
  }
  if (type === "text") {
    if (typeof node.text !== "string" || !node.text) return null;
    out.text = node.text.slice(0, 100_000);
    if (Array.isArray(node.marks)) {
      const marks = node.marks.flatMap((mark): DocMark[] => {
        if (!mark || typeof mark !== "object") return [];
        const markType = String((mark as Record<string, unknown>).type ?? "");
        if (!ALLOWED_MARKS.has(markType)) return [];
        const markAttrs = cleanAttrs((mark as Record<string, unknown>).attrs);
        if (
          markType === "link" &&
          typeof markAttrs?.href === "string" &&
          !/^(https?:|mailto:|tel:)/i.test(markAttrs.href)
        )
          return [];
        return [{ type: markType, ...(markAttrs ? { attrs: markAttrs } : {}) }];
      });
      if (marks.length) out.marks = marks;
    }
    return out;
  }
  if (Array.isArray(node.content))
    out.content = node.content
      .map((item) => cleanDocNode(item, depth + 1))
      .filter((item): item is DocNode => item !== null);
  return out;
}

function cleanStyle(input: unknown): CellStyle | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const style: CellStyle = {};
  for (const flag of ["b", "i", "u", "s", "wrap", "border", "bt", "bb", "bl", "br"] as const)
    if (raw[flag] === true) style[flag] = true;
  if (raw.unlocked === true) style.unlocked = true;
  if (raw.bw === "thin" || raw.bw === "medium" || raw.bw === "thick") style.bw = raw.bw;
  if (typeof raw.bc === "string" && COLOR.test(raw.bc)) style.bc = raw.bc;
  if (typeof raw.font === "string" && FONT_NAMES.includes(raw.font)) style.font = raw.font;
  if (typeof raw.indent === "number" && raw.indent >= 1 && raw.indent <= 10) style.indent = Math.trunc(raw.indent);
  if (typeof raw.color === "string" && COLOR.test(raw.color)) style.color = raw.color;
  if (typeof raw.fill === "string" && COLOR.test(raw.fill)) style.fill = raw.fill;
  if (raw.align === "left" || raw.align === "center" || raw.align === "right") style.align = raw.align;
  if (raw.valign === "top" || raw.valign === "middle" || raw.valign === "bottom") style.valign = raw.valign;
  if (NUMBER_FORMATS.some((item) => item.value === raw.fmt)) style.fmt = raw.fmt as NumberFormat;
  if (typeof raw.dec === "number" && raw.dec >= 0 && raw.dec <= 10) style.dec = Math.trunc(raw.dec);
  if (typeof raw.size === "number" && raw.size >= 6 && raw.size <= 72) style.size = Math.trunc(raw.size);
  return Object.keys(style).length ? style : undefined;
}

const RANGE = /^[A-Z]{1,3}\d+(:[A-Z]{1,3}\d+)?$/;
const RULE_OPS = new Set([
  "gt",
  "lt",
  "ge",
  "le",
  "eq",
  "ne",
  "between",
  "contains",
  "empty",
  "notEmpty",
  "duplicate",
  "scale",
  "bar",
]);
const CHART_TYPES = new Set(["column", "bar", "line", "pie"]);
const indexList = (input: unknown, limit: number) =>
  Array.isArray(input)
    ? [...new Set(input.filter((item): item is number => Number.isInteger(item) && item >= 0 && item < limit))].sort(
        (a, b) => a - b,
      )
    : [];
const clip = (input: unknown, max: number) => (typeof input === "string" ? input.slice(0, max) : "");

const clampInt = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback;

function cleanSheet(input: unknown, index: number): Sheet | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const sheet = newSheet(
    String(raw.name ?? "")
      .replace(/[\\/?*[\]:]/g, "")
      .trim()
      .slice(0, 31) || `Tabelle${index + 1}`,
  );
  if (typeof raw.id === "string" && raw.id.length <= 40) sheet.id = raw.id;
  sheet.rowCount = clampInt(raw.rowCount, 1, 10_000, 100);
  sheet.colCount = clampInt(raw.colCount, 1, 200, 26);
  const cells = raw.cells && typeof raw.cells === "object" ? (raw.cells as Record<string, unknown>) : {};
  for (const [key, value] of Object.entries(cells)) {
    const ref = parseCellKey(key);
    if (!ref || ref.row >= sheet.rowCount || ref.col >= sheet.colCount || !value || typeof value !== "object") continue;
    const cell = value as Record<string, unknown>;
    const v = typeof cell.v === "string" ? cell.v.slice(0, 32_000) : "";
    const s = cleanStyle(cell.s);
    if (v || s) sheet.cells[cellKey(ref.col, ref.row)] = s ? { v, s } : { v };
  }
  for (const [map, limit] of [
    ["cols", 200],
    ["rows", 10_000],
  ] as const) {
    const source = raw[map] && typeof raw[map] === "object" ? (raw[map] as Record<string, unknown>) : {};
    for (const [key, value] of Object.entries(source)) {
      const position = Number(key);
      if (Number.isInteger(position) && position >= 0 && position < limit && typeof value === "number")
        sheet[map][String(position)] = Math.min(800, Math.max(map === "cols" ? 24 : 16, Math.round(value)));
    }
  }
  if (Array.isArray(raw.merges))
    sheet.merges = raw.merges
      .filter((item): item is string => typeof item === "string" && /^[A-Z]{1,3}\d+:[A-Z]{1,3}\d+$/.test(item))
      .slice(0, 2000);
  const freeze = raw.freeze && typeof raw.freeze === "object" ? (raw.freeze as Record<string, unknown>) : {};
  sheet.freeze = { rows: clampInt(freeze.rows, 0, 50, 0), cols: clampInt(freeze.cols, 0, 20, 0) };
  sheet.hiddenRows = indexList(raw.hiddenRows, sheet.rowCount);
  sheet.hiddenCols = indexList(raw.hiddenCols, sheet.colCount);
  const filter = raw.filter && typeof raw.filter === "object" ? (raw.filter as Record<string, unknown>) : null;
  if (filter && typeof filter.range === "string" && RANGE.test(filter.range)) {
    const hidden: Record<string, string[]> = {};
    const source = filter.hidden && typeof filter.hidden === "object" ? (filter.hidden as Record<string, unknown>) : {};
    for (const [col, values] of Object.entries(source))
      if (/^\d{1,3}$/.test(col) && Array.isArray(values))
        hidden[col] = values
          .filter((item): item is string => typeof item === "string")
          .slice(0, 2000)
          .map((item) => item.slice(0, 500));
    sheet.filter = { range: filter.range, hidden };
  }
  if (Array.isArray(raw.validations))
    sheet.validations = raw.validations.slice(0, 200).flatMap((item) => {
      const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const values = Array.isArray(entry.values)
        ? entry.values
            .filter((value): value is string => typeof value === "string" && value.trim() !== "")
            .slice(0, 200)
            .map((value) => value.slice(0, 200))
        : [];
      return typeof entry.range === "string" && RANGE.test(entry.range) && values.length
        ? [{ range: entry.range, values }]
        : [];
    });
  if (Array.isArray(raw.rules))
    sheet.rules = raw.rules.slice(0, 100).flatMap((item): SheetRule[] => {
      const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      if (typeof entry.range !== "string" || !RANGE.test(entry.range) || !RULE_OPS.has(String(entry.op))) return [];
      const style = entry.style && typeof entry.style === "object" ? (entry.style as Record<string, unknown>) : {};
      return [
        {
          id: typeof entry.id === "string" && entry.id.length <= 40 ? entry.id : newId(),
          range: entry.range,
          op: entry.op as RuleOp,
          value: clip(entry.value, 500),
          value2: clip(entry.value2, 500),
          style: {
            ...(typeof style.fill === "string" && COLOR.test(style.fill) ? { fill: style.fill } : {}),
            ...(typeof style.color === "string" && COLOR.test(style.color) ? { color: style.color } : {}),
            ...(style.b === true ? { b: true } : {}),
          },
          ...(entry.op === "scale" || entry.op === "bar"
            ? {
                colors: (Array.isArray(entry.colors) ? entry.colors : [])
                  .filter((color): color is string => typeof color === "string" && COLOR.test(color))
                  .slice(0, entry.op === "scale" ? 3 : 1),
              }
            : {}),
        },
      ];
    });
  if (Array.isArray(raw.charts))
    sheet.charts = raw.charts.slice(0, 20).flatMap((item): SheetChart[] => {
      const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      if (typeof entry.range !== "string" || !RANGE.test(entry.range) || !CHART_TYPES.has(String(entry.type)))
        return [];
      return [
        {
          id: typeof entry.id === "string" && entry.id.length <= 40 ? entry.id : newId(),
          type: entry.type as ChartType,
          range: entry.range,
          title: clip(entry.title, 200),
          x: clampInt(entry.x, 0, 100_000, 40),
          y: clampInt(entry.y, 0, 400_000, 40),
          w: clampInt(entry.w, 160, 2000, 480),
          h: clampInt(entry.h, 120, 1500, 300),
          ...(clip(entry.xTitle, 200) ? { xTitle: clip(entry.xTitle, 200) } : {}),
          ...(clip(entry.yTitle, 200) ? { yTitle: clip(entry.yTitle, 200) } : {}),
          ...(entry.labels === true ? { labels: true } : {}),
        },
      ];
    });
  const print = raw.print && typeof raw.print === "object" ? (raw.print as Record<string, unknown>) : {};
  sheet.print = {
    orientation: print.orientation === "portrait" ? "portrait" : "landscape",
    fit: print.fit !== false,
    gridlines: print.gridlines !== false,
    ...(typeof print.area === "string" && RANGE.test(print.area) ? { area: print.area } : {}),
    ...(clip(print.header, 200) ? { header: clip(print.header, 200) } : {}),
    ...(clip(print.footer, 200) ? { footer: clip(print.footer, 200) } : {}),
    ...(print.pageNumbers === true ? { pageNumbers: true } : {}),
  };
  sheet.showGrid = raw.showGrid !== false;
  if (raw.protected === true) sheet.protected = true;
  const pivot = raw.pivot && typeof raw.pivot === "object" ? (raw.pivot as Record<string, unknown>) : null;
  const field = (value: unknown) =>
    Number.isInteger(value) && Number(value) >= 0 && Number(value) < 200 ? Number(value) : null;
  if (
    pivot &&
    typeof pivot.source === "string" &&
    pivot.source.length <= 40 &&
    typeof pivot.range === "string" &&
    RANGE.test(pivot.range) &&
    field(pivot.rows) !== null &&
    field(pivot.value) !== null &&
    typeof pivot.fn === "string" &&
    pivot.fn in PIVOT_FUNCTIONS
  )
    sheet.pivot = {
      source: pivot.source,
      range: pivot.range,
      rows: field(pivot.rows)!,
      cols: field(pivot.cols),
      value: field(pivot.value)!,
      fn: pivot.fn as PivotFunction,
    };
  // Kommentare je Zelle (nur gültige Zellen innerhalb des Blatts).
  if (raw.comments && typeof raw.comments === "object") {
    const comments: Record<string, CommentThread> = {};
    for (const [key, value] of Object.entries(raw.comments as Record<string, unknown>).slice(
      0,
      COMMENT_LIMITS.threads,
    )) {
      const at = parseCellKey(key);
      const thread = cleanThread(value);
      if (at && at.col < 16_384 && at.row < 1_048_576 && thread) comments[cellKey(at.col, at.row)] = thread;
    }
    if (Object.keys(comments).length) sheet.comments = comments;
  }
  return sheet;
}

function cleanTransition(input: unknown): SlideTransition | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  if (typeof raw.type !== "string" || !(raw.type in SLIDE_TRANSITIONS)) return undefined;
  const speed =
    typeof raw.speed === "string" && raw.speed in TRANSITION_SPEEDS ? (raw.speed as TransitionSpeed) : "med";
  return { type: raw.type as SlideTransitionType, speed };
}

const LAYOUTS = new Set(SLIDE_LAYOUTS.map((item) => item.value));
const SHAPES = new Set(SLIDE_SHAPES.map((item) => item.value));
function cleanSlideItem(input: unknown): SlideItem | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const emu = (value: unknown, max: number) =>
    typeof value === "number" && Number.isFinite(value) ? Math.round(Math.min(max, Math.max(0, value))) : 0;
  const x = emu(raw.x, SLIDE_SIZE.width);
  const y = emu(raw.y, SLIDE_SIZE.height);
  const frame = {
    id: typeof raw.id === "string" && raw.id.length <= 40 ? raw.id : newId(),
    x,
    y,
    w: emu(raw.w, SLIDE_SIZE.width - x),
    h: emu(raw.h, SLIDE_SIZE.height - y),
  };
  const textOf = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");
  const color = (value: unknown) => (typeof value === "string" && COLOR.test(value) ? value.toLowerCase() : "");
  switch (raw.type) {
    case "text":
      return { ...frame, type: "text", body: asDoc(raw.body) };
    case "shape":
      return {
        ...frame,
        type: "shape",
        shape: SHAPES.has(raw.shape as SlideShape) ? (raw.shape as SlideShape) : "rect",
        fill: color(raw.fill),
        line: color(raw.line),
        text: textOf(raw.text, 2000),
      };
    case "table": {
      const rows = (Array.isArray(raw.rows) ? raw.rows : [])
        .slice(0, ITEM_LIMITS.rows)
        .map((row) =>
          (Array.isArray(row) ? row : []).slice(0, ITEM_LIMITS.cols).map((cell) => textOf(cell, ITEM_LIMITS.cell)),
        );
      const cols = Math.max(1, ...rows.map((row) => row.length));
      if (!rows.length) return null;
      // Alle Zeilen gleich lang (fehlende Zellen leer).
      return {
        ...frame,
        type: "table",
        rows: rows.map((row) => Array.from({ length: cols }, (_, col) => row[col] ?? "")),
        header: raw.header !== false,
      };
    }
    case "chart": {
      const categories = (Array.isArray(raw.categories) ? raw.categories : [])
        .slice(0, ITEM_LIMITS.categories)
        .map((item) => textOf(item, 200));
      const series = (Array.isArray(raw.series) ? raw.series : [])
        .slice(0, ITEM_LIMITS.series)
        .flatMap((item): ChartSeries[] => {
          if (!item || typeof item !== "object") return [];
          const entry = item as Record<string, unknown>;
          const values = Array.isArray(entry.values) ? entry.values : [];
          return [
            {
              name: textOf(entry.name, 200),
              values: categories.map((_, index) => {
                const value = values[index];
                return typeof value === "number" && Number.isFinite(value) ? value : 0;
              }),
            },
          ];
        });
      return {
        ...frame,
        type: "chart",
        chart: CHART_TYPES.has(raw.chart as ChartType) ? (raw.chart as ChartType) : "column",
        title: textOf(raw.title, 200),
        categories,
        series,
      };
    }
    default:
      return null;
  }
}

// Inhalt immer als ganzes Dokument (ein einzelner Absatz oder eine Liste wird eingepackt).
function asDoc(input: unknown): DocNode {
  const node = cleanDocNode(input);
  if (!node) return emptyDoc();
  if (node.type !== "doc") return { type: "doc", content: [node] };
  return node.content?.length ? node : emptyDoc();
}

export function cleanModel(kind: OfficeKind, input: unknown): OfficeModel {
  const raw = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  if (kind === "document") {
    const page = raw.page && typeof raw.page === "object" ? (raw.page as Record<string, unknown>) : {};
    return {
      kind,
      page: {
        orientation: page.orientation === "landscape" ? "landscape" : "portrait",
        margins: page.margins === "narrow" || page.margins === "wide" ? page.margins : "normal",
        header: typeof page.header === "string" ? page.header.slice(0, 200) : "",
        footer: typeof page.footer === "string" ? page.footer.slice(0, 200) : "",
        pageNumbers: page.pageNumbers !== false,
      },
      content: asDoc(raw.content),
      ...(cleanThreads(raw.comments).length ? { comments: cleanThreads(raw.comments) } : {}),
      ...(raw.track === true ? { track: true } : {}),
    };
  }
  if (kind === "sheet") {
    const sheets = (Array.isArray(raw.sheets) ? raw.sheets : [])
      .slice(0, 30)
      .map(cleanSheet)
      .filter((item): item is Sheet => item !== null);
    const seen = new Set<string>();
    for (const sheet of sheets) {
      let name = sheet.name;
      for (let index = 2; seen.has(name.toLocaleLowerCase("de-CH")); index += 1) name = `${sheet.name} (${index})`;
      sheet.name = name;
      seen.add(name.toLocaleLowerCase("de-CH"));
    }
    const list = sheets.length ? sheets : [newSheet("Tabelle1")];
    const sheetNames = new Set(list.map((sheet) => sheet.name.toLocaleLowerCase("de-CH")));
    const seenNames = new Set<string>();
    const names = (Array.isArray(raw.names) ? raw.names : []).slice(0, 200).flatMap((item): SheetName[] => {
      const entry = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      const sheet = typeof entry.sheet === "string" ? entry.sheet : "";
      const range = typeof entry.range === "string" ? entry.range.toUpperCase() : "";
      const key = name.toLocaleUpperCase("de-CH");
      if (
        nameProblem(name) ||
        seenNames.has(key) ||
        !sheetNames.has(sheet.toLocaleLowerCase("de-CH")) ||
        !RANGE.test(range)
      )
        return [];
      seenNames.add(key);
      return [
        {
          name,
          sheet: list.find((item) => item.name.toLocaleLowerCase("de-CH") === sheet.toLocaleLowerCase("de-CH"))!.name,
          range,
        },
      ];
    });
    return { kind, sheets: list, ...(names.length ? { names } : {}) };
  }
  const slides = (Array.isArray(raw.slides) ? raw.slides : []).slice(0, 200).flatMap((item): Slide[] => {
    if (!item || typeof item !== "object") return [];
    const slide = item as Record<string, unknown>;
    const image =
      typeof slide.image === "string" && /^data:image\/(png|jpeg|gif|webp);base64,/.test(slide.image)
        ? slide.image
        : "";
    return [
      {
        id: typeof slide.id === "string" && slide.id.length <= 40 ? slide.id : newId(),
        layout: LAYOUTS.has(slide.layout as SlideLayout) ? (slide.layout as SlideLayout) : "content",
        title: typeof slide.title === "string" ? slide.title.slice(0, 500) : "",
        subtitle: typeof slide.subtitle === "string" ? slide.subtitle.slice(0, 500) : "",
        body: asDoc(slide.body),
        body2: asDoc(slide.body2),
        image,
        notes: typeof slide.notes === "string" ? slide.notes.slice(0, 10_000) : "",
        items: (Array.isArray(slide.items) ? slide.items : [])
          .slice(0, ITEM_LIMITS.items)
          .map(cleanSlideItem)
          .filter((entry): entry is SlideItem => entry !== null),
        ...(cleanThreads(slide.comments).length ? { comments: cleanThreads(slide.comments) } : {}),
        ...(cleanTransition(slide.transition) ? { transition: cleanTransition(slide.transition) } : {}),
      },
    ];
  });
  return {
    kind: "deck",
    theme:
      raw.theme && typeof raw.theme === "string" && raw.theme in DECK_THEMES ? (raw.theme as DeckTheme) : "carecore",
    slides: slides.length ? slides : [newSlide("title")],
  };
}

// Reiner Text eines Dokumentknotens (Vorschau, Folien-Übersicht, Suche).
export const plainText = (node: DocNode | undefined): string =>
  !node
    ? ""
    : node.type === "text"
      ? (node.text ?? "")
      : (node.content ?? []).map(plainText).join(node.type === "doc" ? "\n" : " ");

export { cellKey, parseCellKey };

// Folienaufbau in EMU (16:9, wie PowerPoint): gleiche Masse im Editor und in der .pptx-Datei.
export const SLIDE_SIZE = { width: 12_192_000, height: 6_858_000 };
export type SlideBox = { x: number; y: number; w: number; h: number };
export const SLIDE_BOXES: Record<
  SlideLayout,
  {
    title: SlideBox;
    subtitle?: SlideBox;
    body?: SlideBox;
    body2?: SlideBox;
    image?: SlideBox;
    bar?: SlideBox;
    titleSize: number;
    anchor: "t" | "ctr" | "b";
  }
> = {
  title: {
    title: { x: 914_400, y: 1_828_800, w: 10_363_200, h: 1_828_800 },
    bar: { x: 914_400, y: 3_749_040, w: 1_828_800, h: 76_200 },
    subtitle: { x: 914_400, y: 3_962_400, w: 10_363_200, h: 1_097_280 },
    titleSize: 44,
    anchor: "b",
  },
  content: {
    title: { x: 609_600, y: 365_760, w: 10_972_800, h: 1_005_840 },
    bar: { x: 609_600, y: 1_417_320, w: 914_400, h: 45_720 },
    body: { x: 609_600, y: 1_645_920, w: 10_972_800, h: 4_754_880 },
    titleSize: 32,
    anchor: "b",
  },
  two: {
    title: { x: 609_600, y: 365_760, w: 10_972_800, h: 1_005_840 },
    bar: { x: 609_600, y: 1_417_320, w: 914_400, h: 45_720 },
    body: { x: 609_600, y: 1_645_920, w: 5_303_520, h: 4_754_880 },
    body2: { x: 6_278_880, y: 1_645_920, w: 5_303_520, h: 4_754_880 },
    titleSize: 32,
    anchor: "b",
  },
  image: {
    title: { x: 609_600, y: 365_760, w: 10_972_800, h: 1_005_840 },
    bar: { x: 609_600, y: 1_417_320, w: 914_400, h: 45_720 },
    body: { x: 609_600, y: 1_645_920, w: 5_303_520, h: 4_754_880 },
    image: { x: 6_278_880, y: 1_645_920, w: 5_303_520, h: 4_754_880 },
    titleSize: 32,
    anchor: "b",
  },
  section: {
    title: { x: 914_400, y: 2_286_000, w: 10_363_200, h: 1_371_600 },
    subtitle: { x: 914_400, y: 3_749_040, w: 10_363_200, h: 914_400 },
    titleSize: 40,
    anchor: "b",
  },
  blank: {
    title: { x: 609_600, y: 365_760, w: 10_972_800, h: 1_005_840 },
    bar: { x: 609_600, y: 1_417_320, w: 914_400, h: 45_720 },
    titleSize: 32,
    anchor: "b",
  },
};
export const SLIDE_BODY_SIZE = 20;
