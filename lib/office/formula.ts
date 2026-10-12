// Formeln der Tabellen in der Ablage: Rechnen wie in Excel (deutsche und englische Funktionsnamen, „;“ oder „,“
// als Trennzeichen), Zellbezüge (auch auf andere Blätter), Bereiche, Fehlerwerte und Zirkelbezüge.
// Läuft im Browser (Anzeige) und auf dem Server (berechnete Werte in der .xlsx-Datei).

export type ErrorCode =
  "#DIV/0!" | "#NAME?" | "#REF!" | "#VALUE!" | "#N/A" | "#NUM!" | "#CYCLE!" | "#SPILL!" | "#CALC!";
export type CellError = { error: ErrorCode };
export type Value = number | string | boolean | null | CellError;

export const isError = (value: unknown): value is CellError =>
  typeof value === "object" && value !== null && "error" in value;
const fail = (error: ErrorCode): CellError => ({ error });

// Fehler in der Oberfläche wie im deutschen Excel.
export const ERROR_LABELS: Record<ErrorCode, string> = {
  "#DIV/0!": "#DIV/0!",
  "#NAME?": "#NAME?",
  "#REF!": "#BEZUG!",
  "#VALUE!": "#WERT!",
  "#N/A": "#NV",
  "#NUM!": "#ZAHL!",
  "#CYCLE!": "#ZIRKELBEZUG!",
  "#SPILL!": "#ÜBERLAUF!",
  "#CALC!": "#KALK!",
};
export const ERROR_HINTS: Record<ErrorCode, string> = {
  "#DIV/0!": "Division durch null",
  "#NAME?": "Unbekannte Funktion oder unbekannter Name",
  "#REF!": "Ungültiger Zellbezug oder unbekanntes Blatt",
  "#VALUE!": "Falscher Werttyp, z. B. Text statt Zahl",
  "#N/A": "Wert nicht gefunden",
  "#NUM!": "Ungültige Zahl",
  "#CYCLE!": "Die Formel bezieht sich (über Umwege) auf ihre eigene Zelle",
  "#SPILL!": "Das Ergebnis braucht mehrere Zellen, aber dort steht schon etwas",
  "#CALC!": "Das Ergebnis ist leer (z. B. FILTERN ohne Treffer)",
};

// ---------- Zellbezüge ----------

export const MAX_COLS = 702; // A … ZZ
export const MAX_ROWS = 100_000;

export function columnName(index: number) {
  let name = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26))
    name = String.fromCharCode(65 + ((value - 1) % 26)) + name;
  return name;
}

export function columnIndex(name: string) {
  let value = 0;
  for (const char of name.toUpperCase()) value = value * 26 + (char.charCodeAt(0) - 64);
  return value - 1;
}

export const cellKey = (col: number, row: number) => `${columnName(col)}${row + 1}`;

export function parseCellKey(key: string) {
  const match = /^\$?([A-Za-z]{1,3})\$?(\d{1,6})$/.exec(key.trim());
  if (!match) return null;
  const col = columnIndex(match[1]);
  const row = Number(match[2]) - 1;
  if (col < 0 || col >= MAX_COLS || row < 0 || row >= MAX_ROWS) return null;
  return { col, row };
}

export type Area = { c1: number; r1: number; c2: number; r2: number };
export function parseArea(text: string): Area | null {
  const [from, to = from] = text.split(":");
  const a = parseCellKey(from);
  const b = parseCellKey(to);
  if (!a || !b) return null;
  return {
    c1: Math.min(a.col, b.col),
    r1: Math.min(a.row, b.row),
    c2: Math.max(a.col, b.col),
    r2: Math.max(a.row, b.row),
  };
}
export const areaName = (area: Area) =>
  area.c1 === area.c2 && area.r1 === area.r2
    ? cellKey(area.c1, area.r1)
    : `${cellKey(area.c1, area.r1)}:${cellKey(area.c2, area.r2)}`;

// ---------- Datum ----------

const DAY = 86_400_000;
const EPOCH = Date.UTC(1899, 11, 30);
export const dateSerial = (year: number, month: number, day: number) => (Date.UTC(year, month - 1, day) - EPOCH) / DAY;
export function serialDate(serial: number) {
  const date = new Date(EPOCH + Math.floor(serial) * DAY);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}
export function todaySerial(now = new Date()) {
  return dateSerial(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

// ---------- Eingaben ----------

export type ParsedInput =
  | { type: "empty" }
  | { type: "formula"; formula: string }
  | { type: "number"; value: number; format?: "percent" | "date" | "time" | "datetime" }
  | { type: "boolean"; value: boolean }
  | { type: "text"; value: string };

// Eingabe in eine Zelle: Formel, Zahl („1'250.50“, „12,5“, „15%“), Datum („4.10.2026“), Uhrzeit („07:30“),
// Wahrheitswert oder Text (mit führendem Apostroph immer Text).
export function parseInput(raw: string): ParsedInput {
  if (raw === "") return { type: "empty" };
  if (raw.startsWith("=") && raw.length > 1) return { type: "formula", formula: raw.slice(1) };
  if (raw.startsWith("'")) return { type: "text", value: raw.slice(1) };
  const text = raw.trim();
  const upper = text.toUpperCase();
  if (upper === "WAHR" || upper === "TRUE") return { type: "boolean", value: true };
  if (upper === "FALSCH" || upper === "FALSE") return { type: "boolean", value: false };
  const percent = /^([-+]?\d+(?:[.,]\d+)?)\s*%$/.exec(text);
  if (percent) return { type: "number", value: Number(percent[1].replace(",", ".")) / 100, format: "percent" };
  const date = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/.exec(text);
  if (date) {
    const day = Number(date[1]);
    const month = Number(date[2]);
    const year = date[3].length === 2 ? 2000 + Number(date[3]) : Number(date[3]);
    const serial = dateSerial(year, month, day);
    const check = serialDate(serial);
    if (check.day === day && check.month === month) {
      if (date[4] === undefined) return { type: "number", value: serial, format: "date" };
      const minutes = Number(date[4]) * 60 + Number(date[5]);
      if (minutes < 24 * 60) return { type: "number", value: serial + minutes / 1440, format: "datetime" };
    }
  }
  const time = /^(\d{1,2}):(\d{2})$/.exec(text);
  if (time && Number(time[1]) < 24 && Number(time[2]) < 60)
    return { type: "number", value: (Number(time[1]) * 60 + Number(time[2])) / 1440, format: "time" };
  const number = /^[-+]?(?:\d{1,3}(?:['’]\d{3})+|\d+)(?:[.,]\d+)?(?:[eE][-+]?\d+)?$/.exec(text);
  if (number) return { type: "number", value: Number(text.replace(/['’]/g, "").replace(",", ".")) };
  return { type: "text", value: raw };
}

// ---------- Zerlegen ----------

type Token =
  | { t: "num"; v: number }
  | { t: "str"; v: string }
  // spill: „A1#“ = ganzer Überlaufbereich der Zelle A1.
  | { t: "ref"; v: string; sheet?: string; spill?: boolean }
  | { t: "name"; v: string }
  | { t: "op"; v: string }
  | { t: "err"; v: ErrorCode }
  | { t: "cols"; v: string; sheet?: string }
  | { t: "sep" }
  | { t: "(" }
  | { t: ")" };

class SyntaxProblem extends Error {}

const NAME_CHAR = /[A-Za-zÄÖÜäöüß0-9_.]/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (/\s/.test(char)) {
      i += 1;
      continue;
    }
    if (char === '"') {
      let value = "";
      i += 1;
      for (;;) {
        if (i >= source.length) throw new SyntaxProblem("Anführungszeichen nicht geschlossen");
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            value += '"';
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        value += source[i];
        i += 1;
      }
      tokens.push({ t: "str", v: value });
      continue;
    }
    if (char === "'") {
      // 'Blatt mit Leerzeichen'!A1
      const close = source.indexOf("'!", i + 1);
      if (close < 0) throw new SyntaxProblem("Blattname nicht geschlossen");
      const sheet = source.slice(i + 1, close).replace(/''/g, "'");
      i = close + 2;
      const ref = /^\$?[A-Za-z]{1,3}\$?\d+/.exec(source.slice(i));
      if (!ref) throw new SyntaxProblem("Zellbezug erwartet");
      i += ref[0].length;
      const spill = source[i] === "#";
      if (spill) i += 1;
      tokens.push({ t: "ref", v: ref[0], sheet, ...(spill ? { spill } : {}) });
      continue;
    }
    if (/\d/.test(char) || (char === "." && /\d/.test(source[i + 1] ?? ""))) {
      const match = /^\d*\.?\d+(?:[eE][-+]?\d+)?/.exec(source.slice(i))!;
      tokens.push({ t: "num", v: Number(match[0]) });
      i += match[0].length;
      continue;
    }
    if (char === "$" || NAME_CHAR.test(char)) {
      let word = "";
      while (i < source.length && (NAME_CHAR.test(source[i]) || source[i] === "$")) word += source[i++];
      if (source[i] === "!") {
        i += 1;
        const ref = /^\$?[A-Za-z]{1,3}\$?\d+/.exec(source.slice(i));
        if (!ref) throw new SyntaxProblem("Zellbezug erwartet");
        i += ref[0].length;
        const spill = source[i] === "#";
        if (spill) i += 1;
        tokens.push({ t: "ref", v: ref[0], sheet: word, ...(spill ? { spill } : {}) });
        continue;
      }
      if (/^\$?[A-Za-z]{1,3}\$?\d+$/.test(word) && parseCellKey(word)) {
        const spill = source[i] === "#";
        if (spill) i += 1;
        tokens.push({ t: "ref", v: word, ...(spill ? { spill } : {}) });
      } else {
        // Ganze Spalten („A:A“, „B:D“).
        const columns =
          /^\$?[A-Za-z]{1,3}$/.test(word) && source[i] === ":"
            ? /^:(\$?[A-Za-z]{1,3})(?![\w(!])/.exec(source.slice(i))
            : null;
        if (columns) {
          tokens.push({ t: "cols", v: `${word}:${columns[1]}` });
          i += columns[0].length;
        } else tokens.push({ t: "name", v: word });
      }
      continue;
    }
    if (char === "#") {
      const match = /^#(?:BEZUG|REF)!/i.exec(source.slice(i));
      if (!match) throw new SyntaxProblem("Unerwartetes Zeichen „#“");
      tokens.push({ t: "err", v: "#REF!" });
      i += match[0].length;
      continue;
    }
    const two = source.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") {
      tokens.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%:".includes(char)) tokens.push({ t: "op", v: char });
    else if (char === ";" || char === ",") tokens.push({ t: "sep" });
    else if (char === "(") tokens.push({ t: "(" });
    else if (char === ")") tokens.push({ t: ")" });
    else throw new SyntaxProblem(`Unerwartetes Zeichen „${char}“`);
    i += 1;
  }
  return tokens;
}

// ---------- Baum ----------

export type Expr =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "ref"; sheet?: string; col: number; row: number }
  | { k: "range"; sheet?: string; area: Area }
  | { k: "unary"; op: string; arg: Expr }
  | { k: "percent"; arg: Expr }
  | { k: "binary"; op: string; left: Expr; right: Expr }
  | { k: "call"; name: string; args: Expr[] }
  // Name ohne Klammer: Variable aus LET oder LAMBDA (sonst #NAME?).
  | { k: "name"; v: string }
  // Überlaufbereich einer Zelle („A1#“).
  | { k: "spillref"; sheet?: string; col: number; row: number }
  // Aufruf eines berechneten LAMBDA („LAMBDA(x;x*2)(5)“).
  | { k: "invoke"; fn: Expr; args: Expr[] }
  | { k: "error"; code: ErrorCode };

const PRECEDENCE: Record<string, number> = {
  "=": 1,
  "<>": 1,
  "<": 1,
  ">": 1,
  "<=": 1,
  ">=": 1,
  "&": 2,
  "+": 3,
  "-": 3,
  "*": 4,
  "/": 4,
  "^": 5,
};

export function parseFormula(source: string): Expr {
  const tokens = tokenize(source);
  let pos = 0;
  const peek = () => tokens[pos];
  function primary(): Expr {
    const token = tokens[pos++];
    if (!token) throw new SyntaxProblem("Formel unvollständig");
    if (token.t === "num") return { k: "num", v: token.v };
    if (token.t === "str") return { k: "str", v: token.v };
    if (token.t === "err") return { k: "error", code: token.v };
    if (token.t === "cols") {
      const [from, to] = token.v.replace(/\$/g, "").split(":").map(columnIndex);
      return {
        k: "range",
        sheet: token.sheet,
        area: { c1: Math.min(from, to), r1: 0, c2: Math.max(from, to), r2: MAX_ROWS - 1 },
      };
    }
    if (token.t === "op" && (token.v === "-" || token.v === "+")) return { k: "unary", op: token.v, arg: postfix() };
    if (token.t === "(") {
      const inner = expression(0);
      if (peek()?.t !== ")") throw new SyntaxProblem("Klammer nicht geschlossen");
      pos += 1;
      return inner;
    }
    if (token.t === "ref") {
      const start = parseCellKey(token.v);
      if (!start) return { k: "error", code: "#REF!" };
      if (token.spill) return { k: "spillref", sheet: token.sheet, col: start.col, row: start.row };
      const next = peek();
      if (next?.t === "op" && next.v === ":") {
        pos += 1;
        const end = tokens[pos++];
        if (end?.t !== "ref") throw new SyntaxProblem("Bereich unvollständig");
        const area = parseArea(`${token.v}:${end.v}`);
        if (!area) return { k: "error", code: "#REF!" };
        return { k: "range", sheet: token.sheet, area };
      }
      return { k: "ref", sheet: token.sheet, col: start.col, row: start.row };
    }
    if (token.t === "name") {
      const upper = token.v.toUpperCase();
      if (peek()?.t === "(") return { k: "call", name: upper, args: argumentList() };
      if (upper === "WAHR" || upper === "TRUE") return { k: "bool", v: true };
      if (upper === "FALSCH" || upper === "FALSE") return { k: "bool", v: false };
      // In der Datei tragen LET-Variablen die Vorsilbe „_xlpm.“.
      return { k: "name", v: upper.replace(/^_XLPM\./, "") };
    }
    throw new SyntaxProblem("Unerwartetes Zeichen in der Formel");
  }
  // Argumente in Klammern (die öffnende Klammer ist das nächste Zeichen).
  function argumentList(): Expr[] {
    pos += 1;
    const args: Expr[] = [];
    if (peek()?.t === ")") {
      pos += 1;
      return args;
    }
    for (;;) {
      // Leeres Argument („WENN(A1;;1)“) zählt als leer.
      if (peek()?.t === "sep" || peek()?.t === ")") args.push({ k: "str", v: "" });
      else args.push(expression(0));
      const after = tokens[pos++];
      if (after?.t === ")") return args;
      if (after?.t !== "sep") throw new SyntaxProblem("Trennzeichen „;“ oder „)“ erwartet");
    }
  }
  function postfix(): Expr {
    let node = primary();
    // Ergebnis einer Funktion direkt aufrufen: LAMBDA(x;x+1)(5).
    while (peek()?.t === "(" && (node.k === "call" || node.k === "invoke"))
      node = { k: "invoke", fn: node, args: argumentList() };
    while (peek()?.t === "op" && (peek() as { v: string }).v === "%") {
      pos += 1;
      node = { k: "percent", arg: node };
    }
    return node;
  }
  function expression(min: number): Expr {
    let left = postfix();
    for (;;) {
      const token = peek();
      if (token?.t !== "op" || !(token.v in PRECEDENCE)) break;
      const precedence = PRECEDENCE[token.v];
      if (precedence < min) break;
      pos += 1;
      const right = expression(token.v === "^" ? precedence : precedence + 1);
      left = { k: "binary", op: token.v, left, right };
    }
    return left;
  }
  const result = expression(0);
  if (pos < tokens.length) throw new SyntaxProblem("Unerwarteter Rest in der Formel");
  return result;
}

// Prüft eine Formel beim Eingeben; null = in Ordnung, sonst ein verständlicher Hinweis.
export function formulaProblem(source: string) {
  try {
    parseFormula(source);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Formel ungültig";
  }
}

// ---------- Rechnen ----------

type Grid = Value[][];
type Arg = Value | Grid;
export type Resolver = {
  cell: (sheet: string | undefined, col: number, row: number) => Value;
  hasSheet: (sheet: string) => boolean;
  // Benutzte Zeilen eines Blatts: ganze Spalten („A:A“) werden darauf begrenzt.
  rows?: (sheet: string | undefined) => number;
  today?: () => number;
  now?: () => number;
  // Die Zelle, deren Formel gerade berechnet wird (für ZEILE() und SPALTE() ohne Bezug).
  self?: { col: number; row: number };
  // Eingabe einer Zelle (für ISTFORMEL, FORMELTEXT und TEILERGEBNIS).
  raw?: (sheet: string | undefined, col: number, row: number) => string;
  // Überlaufbereich der Formel in einer Zelle (für „A1#“), null wenn sie nicht überläuft.
  spill?: (sheet: string | undefined, col: number, row: number) => Area | null;
  // Ausgeblendete Zeile (Filter immer, von Hand ausgeblendete nur mit „manual“), für TEILERGEBNIS.
  rowHidden?: (sheet: string | undefined, row: number, manual: boolean) => boolean;
  // Benannter Bereich („Plätze“ → Tabelle1!B2:B20), null wenn es den Namen nicht gibt.
  name?: (name: string) => { sheet?: string; area: Area } | null;
};

const isGrid = (value: Arg): value is Grid => Array.isArray(value);

function toNumber(value: Value): number | CellError {
  if (isError(value)) return value;
  if (value === null || value === "") return 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "number") return value;
  const parsed = parseInput(value);
  return parsed.type === "number" ? parsed.value : fail("#VALUE!");
}

export function toText(value: Value): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "WAHR" : "FALSCH";
  if (typeof value === "number") return String(Number(value.toPrecision(15)));
  if (isError(value)) return ERROR_LABELS[value.error];
  return value;
}

const truthy = (value: Value): boolean | CellError => {
  if (isError(value)) return value;
  if (typeof value === "string") {
    const upper = value.toUpperCase();
    if (upper === "WAHR" || upper === "TRUE") return true;
    if (upper === "FALSCH" || upper === "FALSE" || upper === "") return false;
    return fail("#VALUE!");
  }
  return Boolean(value);
};

function compare(left: Value, right: Value): number {
  const rank = (value: Value) => (typeof value === "number" || value === null ? 0 : typeof value === "string" ? 1 : 2);
  let a = left;
  let b = right;
  if (a === null) a = typeof b === "string" ? "" : typeof b === "boolean" ? false : 0;
  if (b === null) b = typeof a === "string" ? "" : typeof a === "boolean" ? false : 0;
  if (rank(a) !== rank(b)) return rank(a) - rank(b);
  if (typeof a === "string" && typeof b === "string")
    return a.localeCompare(b, "de-CH", { sensitivity: "base", numeric: false });
  return Number(a) - Number(b);
}

const scalar = (arg: Arg): Value => {
  if (!isGrid(arg)) return arg;
  if (arg.length === 1 && arg[0].length === 1) return arg[0][0];
  return fail("#VALUE!");
};
const flat = (args: Arg[]) => args.flatMap((arg) => (isGrid(arg) ? arg.flat() : [arg]));

// Zahlen für SUMME & Co.: in Bereichen zählen nur Zahlen, direkt angegebene Werte werden umgewandelt.
function numbers(args: Arg[]): number[] | CellError {
  const out: number[] = [];
  for (const arg of args) {
    if (isGrid(arg)) {
      for (const value of arg.flat()) {
        if (isError(value)) return value;
        if (typeof value === "number") out.push(value);
      }
    } else {
      if (arg === null) continue;
      const number = toNumber(arg);
      if (isError(number)) return number;
      out.push(number);
    }
  }
  return out;
}

// Kriterium für ZÄHLENWENN/SUMMEWENN: „>5“, „<>erledigt“, „=Ja“, „Mo*“ oder ein Wert.
function criterion(raw: Value): (value: Value) => boolean {
  if (typeof raw !== "string") return (value) => !isError(value) && value !== null && compare(value, raw) === 0;
  const match = /^(<=|>=|<>|<|>|=)?(.*)$/.exec(raw)!;
  const op = match[1] ?? "=";
  const operand = parseInput(match[2]);
  const target: Value =
    operand.type === "number" || operand.type === "boolean" ? operand.value : match[2] === "" ? null : match[2];
  if (typeof target === "string" && (op === "=" || op === "<>") && /[*?]/.test(target)) {
    const pattern = new RegExp(
      `^${target
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".")}$`,
      "i",
    );
    return (value) => {
      const hit = typeof value === "string" && pattern.test(value);
      return op === "=" ? hit : !hit;
    };
  }
  return (value) => {
    if (isError(value)) return false;
    if (target === null) return op === "<>" ? value !== null && value !== "" : value === null || value === "";
    if (value === null) return op === "<>";
    if ((typeof target === "number") !== (typeof value === "number")) return op === "<>";
    const result = compare(value, target);
    if (op === "=") return result === 0;
    if (op === "<>") return result !== 0;
    if (op === "<") return result < 0;
    if (op === ">") return result > 0;
    if (op === "<=") return result <= 0;
    return result >= 0;
  };
}

const round = (value: number, digits: number, mode: "half" | "up" | "down") => {
  const factor = 10 ** digits;
  const scaled = Number((Math.abs(value) * factor).toPrecision(15));
  const rounded = mode === "half" ? Math.round(scaled) : mode === "up" ? Math.ceil(scaled) : Math.floor(scaled);
  return (Math.sign(value) * rounded) / factor;
};

type Impl = (args: Arg[], resolver: Resolver) => Arg;

// Werte paarweise verrechnen (wie Excel mit Bereichen: A1:A3*2, A1:A3>B1:B3); einzelne Werte, einzelne
// Zeilen und Spalten werden aufgefüllt, fehlende Stellen ergeben #NV.
function broadcast(args: Arg[], fn: (...values: Value[]) => Value): Arg {
  if (!args.some((arg) => isGrid(arg) && !(arg.length === 1 && arg[0].length === 1)))
    return fn(...args.map((arg) => (isGrid(arg) ? arg[0][0] : arg)));
  let rows = 1;
  let cols = 1;
  for (const arg of args)
    if (isGrid(arg)) {
      rows = Math.max(rows, arg.length);
      cols = Math.max(cols, arg[0]?.length ?? 0);
    }
  if (rows * cols > 200_000) return fail("#NUM!");
  const pick = (arg: Arg, r: number, c: number): Value => {
    if (!isGrid(arg)) return arg;
    const line = arg.length === 1 ? arg[0] : arg[r];
    if (!line) return fail("#N/A");
    const value = line.length === 1 ? line[0] : line[c];
    return value === undefined ? fail("#N/A") : value;
  };
  const out: Grid = [];
  for (let r = 0; r < rows; r += 1) {
    const line: Value[] = [];
    for (let c = 0; c < cols; c += 1) line.push(fn(...args.map((arg) => pick(arg, r, c))));
    out.push(line);
  }
  return out;
}
// Funktionen, die je Wert rechnen, werden mit Bereichen für jede Zelle einzeln berechnet (z. B. RUNDEN(A1:A3;0)).
const LIFTED = new WeakSet<Impl>();
const lifted = (impl: (args: Value[]) => Value): Impl => {
  const wrapped: Impl = (args) => broadcast(args, (...values) => impl(values));
  LIFTED.add(wrapped);
  return wrapped;
};

function numeric(fn: (...values: number[]) => Value, arity: [number, number]): Impl {
  return lifted((args) => {
    if (args.length < arity[0] || args.length > arity[1]) return fail("#VALUE!");
    const values: number[] = [];
    for (const arg of args) {
      const number = toNumber(scalar(arg));
      if (isError(number)) return number;
      values.push(number);
    }
    const result = fn(...values);
    if (typeof result === "number" && !Number.isFinite(result)) return fail("#NUM!");
    return result;
  });
}
function textual(fn: (text: string, ...rest: number[]) => Value, arity: [number, number]): Impl {
  return lifted((args) => {
    if (args.length < arity[0] || args.length > arity[1]) return fail("#VALUE!");
    const first = scalar(args[0]);
    if (isError(first)) return first;
    const rest: number[] = [];
    for (const arg of args.slice(1)) {
      const number = toNumber(scalar(arg));
      if (isError(number)) return number;
      rest.push(number);
    }
    return fn(toText(first), ...rest);
  });
}
const aggregate =
  (fn: (values: number[]) => number | CellError): Impl =>
  (args) => {
    const values = numbers(args);
    return isError(values) ? values : fn(values);
  };

function conditional(args: Arg[], mode: "sum" | "count" | "average"): Value {
  if (args.length < 2 || !isGrid(args[0])) return fail("#VALUE!");
  const range = args[0];
  const test = criterion(scalar(args[1]));
  const values = args[2] !== undefined ? args[2] : range;
  if (!isGrid(values)) return fail("#VALUE!");
  let sum = 0;
  let count = 0;
  range.forEach((row, r) =>
    row.forEach((value, c) => {
      if (!test(value)) return;
      if (mode === "count") return void (count += 1);
      const target = values[r]?.[c] ?? null;
      if (typeof target === "number") {
        sum += target;
        count += 1;
      }
    }),
  );
  if (mode === "count") return count;
  if (mode === "sum") return sum;
  return count ? sum / count : fail("#DIV/0!");
}

const FUNCTIONS: Record<string, Impl> = {
  SUM: aggregate((values) => values.reduce((a, b) => a + b, 0)),
  AVERAGE: aggregate((values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : fail("#DIV/0!"))),
  MIN: aggregate((values) => (values.length ? Math.min(...values) : 0)),
  MAX: aggregate((values) => (values.length ? Math.max(...values) : 0)),
  PRODUCT: aggregate((values) => (values.length ? values.reduce((a, b) => a * b, 1) : 0)),
  MEDIAN: aggregate((values) => {
    if (!values.length) return fail("#NUM!");
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }),
  COUNT: (args) => flat(args).filter((value) => typeof value === "number").length,
  COUNTA: (args) => flat(args).filter((value) => value !== null && value !== "").length,
  COUNTBLANK: (args) => flat(args).filter((value) => value === null || value === "").length,
  SUMIF: (args) => conditional(args, "sum"),
  COUNTIF: (args) => conditional(args, "count"),
  AVERAGEIF: (args) => conditional(args, "average"),
  IF: (args) => {
    if (args.length < 2 || args.length > 3) return fail("#VALUE!");
    const test = truthy(scalar(args[0]));
    if (isError(test)) return test;
    return test ? scalar(args[1]) : args.length > 2 ? scalar(args[2]) : false;
  },
  IFERROR: (args) => {
    if (args.length !== 2) return fail("#VALUE!");
    const value = scalar(args[0]);
    return isError(value) ? scalar(args[1]) : value;
  },
  AND: (args) => {
    const values = flat(args).filter((value) => value !== null);
    if (!values.length) return fail("#VALUE!");
    for (const value of values) {
      const test = truthy(value);
      if (isError(test)) return test;
      if (!test) return false;
    }
    return true;
  },
  OR: (args) => {
    const values = flat(args).filter((value) => value !== null);
    if (!values.length) return fail("#VALUE!");
    let any = false;
    for (const value of values) {
      const test = truthy(value);
      if (isError(test)) return test;
      any = any || test;
    }
    return any;
  },
  NOT: (args) => {
    if (args.length !== 1) return fail("#VALUE!");
    const test = truthy(scalar(args[0]));
    return isError(test) ? test : !test;
  },
  ROUND: numeric((value, digits = 0) => round(value, Math.trunc(digits), "half"), [1, 2]),
  ROUNDUP: numeric((value, digits = 0) => round(value, Math.trunc(digits), "up"), [1, 2]),
  ROUNDDOWN: numeric((value, digits = 0) => round(value, Math.trunc(digits), "down"), [1, 2]),
  INT: numeric((value) => Math.floor(value), [1, 1]),
  ABS: numeric((value) => Math.abs(value), [1, 1]),
  MOD: numeric(
    (value, divisor) => (divisor === 0 ? fail("#DIV/0!") : value - divisor * Math.floor(value / divisor)),
    [2, 2],
  ),
  POWER: numeric((value, exponent) => value ** exponent, [2, 2]),
  SQRT: numeric((value) => (value < 0 ? fail("#NUM!") : Math.sqrt(value)), [1, 1]),
  CONCAT: (args) => {
    const values = flat(args);
    const problem = values.find(isError);
    return problem ?? values.map(toText).join("");
  },
  LEN: textual((text) => text.length, [1, 1]),
  UPPER: textual((text) => text.toLocaleUpperCase("de-CH"), [1, 1]),
  LOWER: textual((text) => text.toLocaleLowerCase("de-CH"), [1, 1]),
  TRIM: textual((text) => text.trim().replace(/\s+/g, " "), [1, 1]),
  LEFT: textual((text, count = 1) => (count < 0 ? fail("#VALUE!") : text.slice(0, count)), [1, 2]),
  RIGHT: textual((text, count = 1) => (count < 0 ? fail("#VALUE!") : count === 0 ? "" : text.slice(-count)), [1, 2]),
  MID: textual(
    (text, start, count) => (start < 1 || count < 0 ? fail("#VALUE!") : text.slice(start - 1, start - 1 + count)),
    [3, 3],
  ),
  TODAY: (args, resolver) => (args.length ? fail("#VALUE!") : (resolver.today?.() ?? todaySerial())),
  NOW: (args, resolver) => {
    if (args.length) return fail("#VALUE!");
    if (resolver.now) return resolver.now();
    const now = new Date();
    return todaySerial(now) + (now.getHours() * 60 + now.getMinutes()) / 1440;
  },
  DATE: numeric((year, month, day) => dateSerial(Math.trunc(year), Math.trunc(month), Math.trunc(day)), [3, 3]),
  YEAR: numeric((serial) => serialDate(serial).year, [1, 1]),
  MONTH: numeric((serial) => serialDate(serial).month, [1, 1]),
  DAY: numeric((serial) => serialDate(serial).day, [1, 1]),
  ISBLANK: (args) => args.length === 1 && scalar(args[0]) === null,
  ISNUMBER: (args) => args.length === 1 && typeof scalar(args[0]) === "number",
  ISTEXT: (args) => args.length === 1 && typeof scalar(args[0]) === "string",
  ISERROR: (args) => args.length === 1 && isError(scalar(args[0])),
  VLOOKUP: (args) => {
    if (args.length < 3 || args.length > 4 || !isGrid(args[1])) return fail("#VALUE!");
    const key = scalar(args[0]);
    if (isError(key)) return key;
    const column = toNumber(scalar(args[2]));
    if (isError(column)) return column;
    const table = args[1];
    if (column < 1 || column > (table[0]?.length ?? 0)) return fail("#REF!");
    const approximate = args.length < 4 ? true : truthy(scalar(args[3]));
    if (isError(approximate)) return approximate;
    if (!approximate) {
      const row = table.find((line) => line[0] !== null && compare(line[0], key) === 0);
      return row ? row[Math.trunc(column) - 1] : fail("#N/A");
    }
    let found: Value[] | null = null;
    for (const line of table) {
      if (line[0] === null) continue;
      if (compare(line[0], key) <= 0) found = line;
      else break;
    }
    return found ? found[Math.trunc(column) - 1] : fail("#N/A");
  },
};

// ---------- Weitere Funktionen (wie Excel) ----------

const numberArg = (arg: Arg | undefined, fallback?: number): number | CellError =>
  arg === undefined ? (fallback ?? fail("#VALUE!")) : toNumber(scalar(arg));
const textArg = (arg: Arg | undefined, fallback = ""): string | CellError => {
  if (arg === undefined) return fallback;
  const value = scalar(arg);
  return isError(value) ? value : toText(value);
};
const toGrid = (arg: Arg): Grid => (isGrid(arg) ? arg : [[arg]]);
// Eine Zeile oder Spalte als Liste (für VERGLEICH, XVERWEIS & Co.).
const vector = (arg: Arg): Value[] | null =>
  !isGrid(arg)
    ? [arg]
    : arg.length === 1
      ? arg[0]
      : arg.every((line) => line.length === 1)
        ? arg.map((line) => line[0])
        : null;
const wildcard = (pattern: string) =>
  new RegExp(
    `^${pattern.replace(/~([*?~])|([.+^${}()|[\]\\])|(\*)|(\?)/g, (_, escaped, special, star, question) =>
      escaped ? `\\${escaped}` : special ? `\\${special}` : star ? ".*" : question ? "." : "",
    )}$`,
    "i",
  );
// Genaue Übereinstimmung beim Nachschlagen (Text ohne Gross-/Kleinschreibung, optional mit * und ?).
function matcher(key: Value, wildcards: boolean): (value: Value) => boolean {
  if (wildcards && typeof key === "string" && /[*?]/.test(key)) {
    const pattern = wildcard(key);
    return (value) => typeof value === "string" && pattern.test(value);
  }
  return (value) => value !== null && !isError(value) && typeof value === typeof key && compare(value, key) === 0;
}
// Position in einer Liste: 0 = genau, 1 = grösster Wert ≤ Suchwert (aufsteigend), -1 = kleinster Wert ≥ Suchwert.
function position(list: Value[], key: Value, mode: number, wildcards = true): number {
  if (mode === 0) return list.findIndex(matcher(key, wildcards));
  let found = -1;
  for (let index = 0; index < list.length; index += 1) {
    const value = list[index];
    if (value === null || isError(value) || typeof value !== typeof key) continue;
    const result = compare(value, key);
    if (mode > 0 ? result <= 0 : result >= 0) found = index;
    else break;
  }
  return found;
}

function multiConditional(args: Arg[], mode: "sum" | "count" | "average" | "max" | "min"): Value {
  const target = mode === "count" ? null : args[0];
  const pairs = mode === "count" ? args : args.slice(1);
  if (pairs.length < 2 || pairs.length % 2 || (target !== null && !isGrid(target))) return fail("#VALUE!");
  const ranges: Grid[] = [];
  const tests: ((value: Value) => boolean)[] = [];
  for (let index = 0; index < pairs.length; index += 2) {
    const range = pairs[index];
    const raw = scalar(pairs[index + 1]);
    if (!isGrid(range)) return fail("#VALUE!");
    if (isError(raw)) return raw;
    ranges.push(range);
    tests.push(criterion(raw));
  }
  const shape = target ?? ranges[0];
  const width = shape[0]?.length ?? 0;
  if (ranges.some((range) => range.length !== shape.length || (range[0]?.length ?? 0) !== width))
    return fail("#VALUE!");
  let count = 0;
  const hits: number[] = [];
  shape.forEach((line, r) =>
    line.forEach((value, c) => {
      if (!tests.every((test, k) => test(ranges[k][r][c]))) return;
      count += 1;
      if (target !== null && typeof value === "number") hits.push(value);
    }),
  );
  if (mode === "count") return count;
  if (mode === "sum") return hits.reduce((a, b) => a + b, 0);
  if (mode === "average") return hits.length ? hits.reduce((a, b) => a + b, 0) / hits.length : fail("#DIV/0!");
  if (!hits.length) return 0;
  return mode === "max" ? Math.max(...hits) : Math.min(...hits);
}

function deviation(values: number[], sample: boolean): number | CellError {
  if (values.length < (sample ? 2 : 1)) return fail("#DIV/0!");
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - (sample ? 1 : 0));
}
const precise = (value: number) => Number(value.toPrecision(15));

// Wochentag 0 = Sonntag … 6 = Samstag.
const dayOfWeek = (serial: number) => new Date(EPOCH + Math.floor(serial) * DAY).getUTCDay();
const lastDayOfMonth = (year: number, month: number) => serialDate(dateSerial(year, month + 1, 0)).day;
function addMonths(serial: number, months: number) {
  const { year, month, day } = serialDate(serial);
  const target = month + Math.trunc(months);
  return dateSerial(year, target, Math.min(day, lastDayOfMonth(year, target)));
}
// Erster Wochentag je Typ von WOCHENTAG/KALENDERWOCHE (0 = Sonntag).
const WEEK_START: Record<number, number> = { 1: 0, 2: 1, 11: 1, 12: 2, 13: 3, 14: 4, 15: 5, 16: 6, 17: 0 };
function isoWeek(serial: number) {
  const day = Math.floor(serial);
  const thursday = day - ((dayOfWeek(day) + 6) % 7) + 3;
  const year = serialDate(thursday).year;
  return Math.floor((thursday - dateSerial(year, 1, 1)) / 7) + 1;
}
const isWorkday = (serial: number, holidays: Set<number>) => {
  const day = dayOfWeek(serial);
  return day !== 0 && day !== 6 && !holidays.has(Math.floor(serial));
};
function holidayList(arg: Arg | undefined): Set<number> | CellError {
  const set = new Set<number>();
  if (arg === undefined) return set;
  for (const value of toGrid(arg).flat()) {
    if (isError(value)) return value;
    if (value === null || value === "") continue;
    const number = toNumber(value);
    if (isError(number)) return number;
    set.add(Math.floor(number));
  }
  return set;
}
const secondsOf = (serial: number) => Math.round((serial - Math.floor(serial)) * 86_400) % 86_400;

const WEEKDAY_NAMES = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"];
const MONTH_NAMES = [
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
];

// Formatcode von TEXT(): Abschnitte „positiv;negativ;null;Text“, Zahlen (0, #, Tausender- und Dezimalzeichen,
// %), Datum und Zeit (TT/DD, MM, MMM, MMMM, JJJJ/YYYY, hh, mm, ss), Text in Anführungszeichen.
type CodePart = { lit: string } | { pat: string };
function codeParts(section: string): CodePart[] {
  const parts: CodePart[] = [];
  const literal = (text: string) => {
    const last = parts[parts.length - 1];
    if (last && "lit" in last) last.lit += text;
    else parts.push({ lit: text });
  };
  for (let i = 0; i < section.length; i += 1) {
    const char = section[i];
    if (char === '"') {
      const close = section.indexOf('"', i + 1);
      literal(section.slice(i + 1, close < 0 ? undefined : close));
      i = close < 0 ? section.length : close;
    } else if (char === "\\") {
      literal(section[i + 1] ?? "");
      i += 1;
    } else if ("0#?".includes(char) || (".,".includes(char) && /[0#?]/.test(section[i + 1] ?? ""))) {
      let pattern = "";
      while (i < section.length && /[0#?.,'’]/.test(section[i])) pattern += section[i++];
      // Ein Trennzeichen am Ende („0.“) gehört nicht mehr zur Zahl.
      const trailing = /[.,'’]+$/.exec(pattern)?.[0] ?? "";
      parts.push({ pat: pattern.slice(0, pattern.length - trailing.length) });
      if (trailing) literal(trailing);
      i -= 1;
    } else literal(char);
  }
  return parts;
}
function formatNumberPattern(value: number, pattern: string) {
  const separators = [...pattern].filter((char) => ".,'’".includes(char));
  let decimal = "";
  let thousands = "";
  const marks = [...new Set(separators.filter((char) => char === "." || char === ","))];
  if (separators.some((char) => char === "'" || char === "’")) {
    thousands = separators.find((char) => char === "'" || char === "’")!;
    decimal = marks[0] ?? "";
  } else if (marks.length === 2) {
    decimal = pattern.lastIndexOf(".") > pattern.lastIndexOf(",") ? "." : ",";
    thousands = decimal === "." ? "," : ".";
  } else if (marks.length === 1) {
    const mark = marks[0];
    const tail = pattern.slice(pattern.lastIndexOf(mark) + 1);
    // „#,##0“ gruppiert Tausender, „0,00“ trennt Dezimalstellen.
    if ((pattern[pattern.indexOf(mark) - 1] === "#" && tail.length === 3) || separators.length > 1) thousands = mark;
    else decimal = mark;
  }
  const decimalAt = decimal ? pattern.lastIndexOf(decimal) : -1;
  const intPattern = (decimalAt < 0 ? pattern : pattern.slice(0, decimalAt)).replace(/[.,'’]/g, "");
  const decPattern = decimalAt < 0 ? "" : pattern.slice(decimalAt + 1).replace(/[.,'’]/g, "");
  const places = decPattern.length;
  const minPlaces = decPattern.replace(/[#?]+$/, "").length;
  const fixed = Math.abs(value).toFixed(places);
  let [whole, fraction = ""] = fixed.split(".");
  while (fraction.length > minPlaces && fraction.endsWith("0")) fraction = fraction.slice(0, -1);
  const minWhole = intPattern.replace(/^[#?]+/, "").length;
  if (whole === "0" && minWhole === 0) whole = "";
  whole = whole.padStart(minWhole, "0");
  if (thousands) whole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, thousands);
  return whole + (fraction || (places && minPlaces) ? `${decimal}${fraction}` : "");
}
function formatDatePart(serial: number, section: string) {
  type Piece = { kind: "lit"; text: string } | { kind: "y" | "d" | "m" | "h" | "s"; size: number };
  const pieces: Piece[] = [];
  for (let i = 0; i < section.length;) {
    const rest = section.slice(i);
    const char = rest[0];
    if (char === '"') {
      const close = section.indexOf('"', i + 1);
      pieces.push({ kind: "lit", text: section.slice(i + 1, close < 0 ? undefined : close) });
      i = close < 0 ? section.length : close + 1;
      continue;
    }
    if (char === "\\") {
      pieces.push({ kind: "lit", text: rest[1] ?? "" });
      i += 2;
      continue;
    }
    const run = /^([JjYy]+|[TtDd]+|[Mm]+|[Hh]+|[Ss]+)/.exec(rest);
    if (run) {
      const letter = run[1][0].toLowerCase();
      const kind =
        letter === "j" || letter === "y" ? "y" : letter === "t" || letter === "d" ? "d" : (letter as "m" | "h" | "s");
      pieces.push({ kind, size: run[1].length });
      i += run[1].length;
      continue;
    }
    pieces.push({ kind: "lit", text: char });
    i += 1;
  }
  const date = serialDate(serial);
  const seconds = secondsOf(serial);
  const units = pieces.filter((piece) => piece.kind !== "lit");
  return pieces
    .map((piece) => {
      if (piece.kind === "lit") return piece.text;
      const at = units.indexOf(piece);
      const minute =
        piece.kind === "m" && piece.size <= 2 && (units[at - 1]?.kind === "h" || units[at + 1]?.kind === "s");
      switch (piece.kind) {
        case "y":
          return piece.size <= 2 ? String(date.year % 100).padStart(2, "0") : String(date.year);
        case "d":
          if (piece.size >= 4) return WEEKDAY_NAMES[dayOfWeek(serial)];
          if (piece.size === 3) return WEEKDAY_NAMES[dayOfWeek(serial)].slice(0, 2);
          return String(date.day).padStart(piece.size, "0");
        case "m":
          if (minute) return String(Math.floor(seconds / 60) % 60).padStart(piece.size, "0");
          if (piece.size >= 4) return MONTH_NAMES[date.month - 1];
          if (piece.size === 3) return MONTH_NAMES[date.month - 1].slice(0, 3);
          return String(date.month).padStart(piece.size, "0");
        case "h":
          return String(Math.floor(seconds / 3600)).padStart(Math.min(2, piece.size), "0");
        case "s":
          return String(seconds % 60).padStart(Math.min(2, piece.size), "0");
      }
    })
    .join("");
}
export function formatWithCode(value: Value, code: string): string | CellError {
  if (isError(value)) return value;
  const sections: string[] = [];
  let current = "";
  let quoted = false;
  for (const char of code) {
    if (char === '"') quoted = !quoted;
    if (char === ";" && !quoted) {
      sections.push(current);
      current = "";
    } else current += char;
  }
  sections.push(current);
  let number = typeof value === "number" ? value : null;
  if (typeof value === "string") {
    const parsed = parseInput(value);
    if (parsed.type === "number") number = parsed.value;
  }
  if (number === null) {
    const text = toText(value);
    const section = sections[3] ?? sections.find((item) => item.includes("@"));
    if (!section) return text;
    return codeParts(section)
      .map((part) => ("lit" in part ? part.lit : part.pat))
      .join("")
      .replace(/@/g, text);
  }
  let section = sections[0];
  let sign = number < 0 ? "-" : "";
  if (number < 0 && sections[1] !== undefined) {
    section = sections[1];
    sign = "";
  } else if (number === 0 && sections[2] !== undefined) section = sections[2];
  const unquoted = section.replace(/"[^"]*"/g, "").replace(/\\./g, "");
  if (!/[0#?]/.test(unquoted) && /[JjYyTtDdMmHhSs]/.test(unquoted)) return formatDatePart(Math.abs(number), section);
  const parts = codeParts(section);
  const percents = parts.reduce((sum, part) => sum + ("lit" in part ? (part.lit.match(/%/g) ?? []).length : 0), 0);
  const scaled = Math.abs(number) * 100 ** percents;
  let used = false;
  const body = parts
    .map((part) => {
      if ("lit" in part) return part.lit;
      if (used) return "";
      used = true;
      return formatNumberPattern(scaled, part.pat);
    })
    .join("");
  return used && /[1-9]/.test(body) ? sign + body : body;
}

Object.assign(FUNCTIONS, {
  SUMIFS: (args) => multiConditional(args, "sum"),
  COUNTIFS: (args) => multiConditional(args, "count"),
  AVERAGEIFS: (args) => multiConditional(args, "average"),
  MAXIFS: (args) => multiConditional(args, "max"),
  MINIFS: (args) => multiConditional(args, "min"),
  IFNA: (args) => {
    if (args.length !== 2) return fail("#VALUE!");
    const value = scalar(args[0]);
    return isError(value) && value.error === "#N/A" ? scalar(args[1]) : value;
  },
  IFS: (args) => {
    if (args.length < 2 || args.length % 2) return fail("#VALUE!");
    for (let index = 0; index < args.length; index += 2) {
      const test = truthy(scalar(args[index]));
      if (isError(test)) return test;
      if (test) return scalar(args[index + 1]);
    }
    return fail("#N/A");
  },
  SWITCH: (args) => {
    if (args.length < 3) return fail("#VALUE!");
    const value = scalar(args[0]);
    if (isError(value)) return value;
    const pairs = args.slice(1);
    for (let index = 0; index + 1 < pairs.length; index += 2) {
      const candidate = scalar(pairs[index]);
      if (isError(candidate)) return candidate;
      if (typeof candidate === typeof value && compare(candidate, value) === 0) return scalar(pairs[index + 1]);
    }
    return pairs.length % 2 ? scalar(pairs[pairs.length - 1]) : fail("#N/A");
  },
  CHOOSE: (args) => {
    const index = numberArg(args[0]);
    if (isError(index)) return index;
    const choice = Math.trunc(index);
    return choice < 1 || choice >= args.length ? fail("#VALUE!") : scalar(args[choice]);
  },
  XOR: (args) => {
    const values = flat(args).filter((value) => value !== null);
    if (!values.length) return fail("#VALUE!");
    let count = 0;
    for (const value of values) {
      const test = truthy(value);
      if (isError(test)) return test;
      if (test) count += 1;
    }
    return count % 2 === 1;
  },
  NA: (args) => (args.length ? fail("#VALUE!") : fail("#N/A")),
  MATCH: (args) => {
    if (args.length < 2 || args.length > 3) return fail("#VALUE!");
    const key = scalar(args[0]);
    if (isError(key)) return key;
    const list = vector(args[1]);
    if (!list) return fail("#N/A");
    const mode = numberArg(args[2], 1);
    if (isError(mode)) return mode;
    const found = position(list, key, Math.sign(Math.trunc(mode)));
    return found < 0 ? fail("#N/A") : found + 1;
  },
  INDEX: (args) => {
    if (args.length < 2 || args.length > 3) return fail("#VALUE!");
    const grid = toGrid(args[0]);
    const first = numberArg(args[1]);
    if (isError(first)) return first;
    const second = numberArg(args[2], 0);
    if (isError(second)) return second;
    let row = Math.trunc(first);
    let col = Math.trunc(second);
    // Bei einer einzelnen Zeile meint die erste Zahl die Spalte (wie Excel).
    if (args.length === 2 && grid.length === 1) [row, col] = [1, row];
    if (row === 0 && grid.length === 1) row = 1;
    if (col === 0 && (grid[0]?.length ?? 0) === 1) col = 1;
    if (row < 1 || col < 1 || row > grid.length || col > (grid[0]?.length ?? 0)) return fail("#REF!");
    return grid[row - 1][col - 1];
  },
  XLOOKUP: (args) => {
    if (args.length < 3 || args.length > 6) return fail("#VALUE!");
    const key = scalar(args[0]);
    if (isError(key)) return key;
    const list = vector(args[1]);
    const results = toGrid(args[2]);
    if (!list) return fail("#VALUE!");
    const mode = numberArg(args[4], 0);
    const direction = numberArg(args[5], 1);
    if (isError(mode)) return mode;
    if (isError(direction)) return direction;
    const indexes = list.map((_, index) => index);
    if (direction < 0) indexes.reverse();
    let found = -1;
    if (mode === 0 || mode === 2) {
      const test = matcher(key, mode === 2);
      found = indexes.find((index) => test(list[index])) ?? -1;
    } else {
      // Genau oder nächstkleiner (-1) bzw. nächstgrösser (1), unabhängig von der Sortierung.
      let best: Value = null;
      for (const index of indexes) {
        const value = list[index];
        if (value === null || isError(value) || typeof value !== typeof key) continue;
        const result = compare(value, key);
        if (result === 0) {
          found = index;
          break;
        }
        if (
          (mode < 0 ? result < 0 : result > 0) &&
          (best === null || (mode < 0 ? compare(value, best) > 0 : compare(value, best) < 0))
        ) {
          best = value;
          found = index;
        }
      }
    }
    if (found < 0) return args[3] !== undefined ? scalar(args[3]) : fail("#N/A");
    if (results.length === list.length) return results[found][0];
    return results.length === 1 && (results[0]?.length ?? 0) === list.length ? results[0][found] : fail("#VALUE!");
  },
  HLOOKUP: (args, resolver) => {
    if (args.length < 3 || args.length > 4 || !isGrid(args[1])) return fail("#VALUE!");
    const table = args[1];
    const transposed: Grid = (table[0] ?? []).map((_, c) => table.map((line) => line[c]));
    return FUNCTIONS.VLOOKUP([args[0], transposed, ...args.slice(2)], resolver);
  },
  LARGE: (args) => {
    if (args.length !== 2) return fail("#VALUE!");
    const values = numbers([args[0]]);
    const k = numberArg(args[1]);
    if (isError(values)) return values;
    if (isError(k)) return k;
    const sorted = [...values].sort((a, b) => b - a);
    const at = Math.ceil(k);
    return at < 1 || at > sorted.length ? fail("#NUM!") : sorted[at - 1];
  },
  SMALL: (args) => {
    if (args.length !== 2) return fail("#VALUE!");
    const values = numbers([args[0]]);
    const k = numberArg(args[1]);
    if (isError(values)) return values;
    if (isError(k)) return k;
    const sorted = [...values].sort((a, b) => a - b);
    const at = Math.ceil(k);
    return at < 1 || at > sorted.length ? fail("#NUM!") : sorted[at - 1];
  },
  RANK: (args) => {
    if (args.length < 2 || args.length > 3 || !isGrid(args[1])) return fail("#VALUE!");
    const value = numberArg(args[0]);
    const order = numberArg(args[2], 0);
    const values = numbers([args[1]]);
    if (isError(value)) return value;
    if (isError(order)) return order;
    if (isError(values)) return values;
    if (!values.includes(value)) return fail("#N/A");
    return 1 + values.filter((other) => (order ? other < value : other > value)).length;
  },
  MODE: aggregate((values) => {
    const counts = new Map<number, number>();
    let best: number | null = null;
    for (const value of values) {
      const count = (counts.get(value) ?? 0) + 1;
      counts.set(value, count);
      if (count > 1 && (best === null || count > counts.get(best)!)) best = value;
    }
    return best ?? fail("#N/A");
  }),
  STDEV: aggregate((values) => {
    const variance = deviation(values, true);
    return isError(variance) ? variance : Math.sqrt(variance);
  }),
  "STDEV.P": aggregate((values) => {
    const variance = deviation(values, false);
    return isError(variance) ? variance : Math.sqrt(variance);
  }),
  VAR: aggregate((values) => deviation(values, true)),
  "VAR.P": aggregate((values) => deviation(values, false)),
  SUMPRODUCT: (args) => {
    if (!args.length) return fail("#VALUE!");
    const grids = args.map(toGrid);
    const height = grids[0].length;
    const width = grids[0][0]?.length ?? 0;
    if (grids.some((grid) => grid.length !== height || (grid[0]?.length ?? 0) !== width)) return fail("#VALUE!");
    let sum = 0;
    for (let r = 0; r < height; r += 1)
      for (let c = 0; c < width; c += 1) {
        let product = 1;
        for (const grid of grids) {
          const value = grid[r][c];
          if (isError(value)) return value;
          product *= typeof value === "number" ? value : 0;
        }
        sum += product;
      }
    return sum;
  },
  SUMSQ: aggregate((values) => values.reduce((sum, value) => sum + value * value, 0)),
  CEILING: numeric(
    (value, step = 1) => {
      if (step === 0) return 0;
      if (value > 0 && step < 0) return fail("#NUM!");
      return precise(Math.ceil(precise(value / step)) * step);
    },
    [1, 2],
  ),
  FLOOR: numeric(
    (value, step = 1) => {
      if (step === 0) return value === 0 ? 0 : fail("#DIV/0!");
      if (value > 0 && step < 0) return fail("#NUM!");
      return precise(Math.floor(precise(value / step)) * step);
    },
    [1, 2],
  ),
  MROUND: numeric(
    (value, step) => {
      if (step === 0) return 0;
      if (Math.sign(value) * Math.sign(step) < 0) return fail("#NUM!");
      return precise(round(value / step, 0, "half") * step);
    },
    [2, 2],
  ),
  TRUNC: numeric((value, digits = 0) => round(value, Math.trunc(digits), "down"), [1, 2]),
  EVEN: numeric((value) => Math.sign(value) * Math.ceil(Math.abs(value) / 2) * 2, [1, 1]),
  ODD: numeric(
    (value) => {
      const up = Math.ceil(Math.abs(value));
      return Math.sign(value || 1) * (up % 2 ? up : up + 1);
    },
    [1, 1],
  ),
  SIGN: numeric((value) => Math.sign(value), [1, 1]),
  PI: numeric(() => Math.PI, [0, 0]),
  EXP: numeric((value) => Math.exp(value), [1, 1]),
  LN: numeric((value) => (value <= 0 ? fail("#NUM!") : Math.log(value)), [1, 1]),
  LOG10: numeric((value) => (value <= 0 ? fail("#NUM!") : Math.log10(value)), [1, 1]),
  LOG: numeric(
    (value, base = 10) =>
      value <= 0 || base <= 0 || base === 1 ? fail("#NUM!") : precise(Math.log(value) / Math.log(base)),
    [1, 2],
  ),
  QUOTIENT: numeric((value, divisor) => (divisor === 0 ? fail("#DIV/0!") : Math.trunc(value / divisor)), [2, 2]),
  GCD: aggregate((values) => {
    if (values.some((value) => value < 0)) return fail("#NUM!");
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    return values.map(Math.trunc).reduce(gcd, 0);
  }),
  LCM: aggregate((values) => {
    if (values.some((value) => value < 0)) return fail("#NUM!");
    const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
    return values.map(Math.trunc).reduce((a, b) => (a === 0 || b === 0 ? 0 : (a * b) / gcd(a, b)), 1);
  }),
  SIN: numeric((value) => Math.sin(value), [1, 1]),
  COS: numeric((value) => Math.cos(value), [1, 1]),
  TAN: numeric((value) => Math.tan(value), [1, 1]),
  RADIANS: numeric((value) => (value * Math.PI) / 180, [1, 1]),
  DEGREES: numeric((value) => (value * 180) / Math.PI, [1, 1]),
  RAND: numeric(() => Math.random(), [0, 0]),
  RANDBETWEEN: numeric(
    (low, high) => {
      const min = Math.ceil(low);
      const max = Math.floor(high);
      return min > max ? fail("#NUM!") : min + Math.floor(Math.random() * (max - min + 1));
    },
    [2, 2],
  ),
  SUBSTITUTE: (args) => {
    if (args.length < 3 || args.length > 4) return fail("#VALUE!");
    const [text, from, to] = [textArg(args[0]), textArg(args[1]), textArg(args[2])];
    if (isError(text)) return text;
    if (isError(from)) return from;
    if (isError(to)) return to;
    if (!from) return text;
    if (args[3] === undefined) return text.split(from).join(to);
    const instance = numberArg(args[3]);
    if (isError(instance)) return instance;
    if (instance < 1) return fail("#VALUE!");
    let at = -1;
    for (let count = 0; count < Math.trunc(instance); count += 1) {
      at = text.indexOf(from, at + 1);
      if (at < 0) return text;
    }
    return text.slice(0, at) + to + text.slice(at + from.length);
  },
  REPLACE: (args) => {
    if (args.length !== 4) return fail("#VALUE!");
    const text = textArg(args[0]);
    const start = numberArg(args[1]);
    const count = numberArg(args[2]);
    const insert = textArg(args[3]);
    if (isError(text)) return text;
    if (isError(start)) return start;
    if (isError(count)) return count;
    if (isError(insert)) return insert;
    if (start < 1 || count < 0) return fail("#VALUE!");
    return text.slice(0, Math.trunc(start) - 1) + insert + text.slice(Math.trunc(start) - 1 + Math.trunc(count));
  },
  FIND: (args) => {
    if (args.length < 2 || args.length > 3) return fail("#VALUE!");
    const find = textArg(args[0]);
    const within = textArg(args[1]);
    const start = numberArg(args[2], 1);
    if (isError(find)) return find;
    if (isError(within)) return within;
    if (isError(start)) return start;
    if (start < 1 || start > within.length + 1) return fail("#VALUE!");
    const at = within.indexOf(find, Math.trunc(start) - 1);
    return at < 0 ? fail("#VALUE!") : at + 1;
  },
  SEARCH: (args) => {
    if (args.length < 2 || args.length > 3) return fail("#VALUE!");
    const find = textArg(args[0]);
    const within = textArg(args[1]);
    const start = numberArg(args[2], 1);
    if (isError(find)) return find;
    if (isError(within)) return within;
    if (isError(start)) return start;
    if (start < 1 || start > within.length + 1) return fail("#VALUE!");
    const source = wildcard(find).source.slice(1, -1);
    const match = new RegExp(source, "i").exec(within.slice(Math.trunc(start) - 1));
    return match ? match.index + Math.trunc(start) : fail("#VALUE!");
  },
  TEXTJOIN: (args) => {
    if (args.length < 3) return fail("#VALUE!");
    const separator = textArg(args[0]);
    const skip = truthy(scalar(args[1]));
    if (isError(separator)) return separator;
    if (isError(skip)) return skip;
    const values = flat(args.slice(2));
    const problem = values.find(isError);
    if (problem) return problem;
    return values
      .map(toText)
      .filter((text) => !skip || text !== "")
      .join(separator);
  },
  VALUE: (args) => {
    if (args.length !== 1) return fail("#VALUE!");
    const value = scalar(args[0]);
    if (isError(value) || typeof value === "number") return value;
    const parsed = parseInput(toText(value).trim());
    return parsed.type === "number" ? parsed.value : parsed.type === "empty" ? 0 : fail("#VALUE!");
  },
  PROPER: textual(
    (text) =>
      text
        .toLocaleLowerCase("de-CH")
        .replace(
          /(^|[^\p{L}])(\p{L})/gu,
          (_, before: string, letter: string) => before + letter.toLocaleUpperCase("de-CH"),
        ),
    [1, 1],
  ),
  REPT: textual(
    (text, count) => (count < 0 || text.length * count > 32_767 ? fail("#VALUE!") : text.repeat(Math.trunc(count))),
    [2, 2],
  ),
  EXACT: (args) => {
    if (args.length !== 2) return fail("#VALUE!");
    const a = textArg(args[0]);
    const b = textArg(args[1]);
    if (isError(a)) return a;
    if (isError(b)) return b;
    return a === b;
  },
  TEXT: (args) => {
    if (args.length !== 2) return fail("#VALUE!");
    const value = scalar(args[0]);
    const code = textArg(args[1]);
    if (isError(code)) return code;
    return formatWithCode(value, code);
  },
  CHAR: numeric((code) => (code < 1 || code > 255 ? fail("#VALUE!") : String.fromCharCode(Math.trunc(code))), [1, 1]),
  CODE: textual((text) => (text ? text.charCodeAt(0) : fail("#VALUE!")), [1, 1]),
  CLEAN: textual((text) => text.replace(/[\u0000-\u001f]/g, ""), [1, 1]),
  WEEKDAY: (args) => {
    if (args.length < 1 || args.length > 2) return fail("#VALUE!");
    const serial = numberArg(args[0]);
    const type = numberArg(args[1], 1);
    if (isError(serial)) return serial;
    if (isError(type)) return type;
    const kind = Math.trunc(type);
    const start = kind === 3 ? 1 : WEEK_START[kind];
    if (start === undefined) return fail("#NUM!");
    const result = ((dayOfWeek(serial) - start + 7) % 7) + 1;
    return kind === 3 ? result - 1 : result;
  },
  WEEKNUM: (args) => {
    if (args.length < 1 || args.length > 2) return fail("#VALUE!");
    const serial = numberArg(args[0]);
    const type = numberArg(args[1], 1);
    if (isError(serial)) return serial;
    if (isError(type)) return type;
    if (Math.trunc(type) === 21) return isoWeek(serial);
    const start = WEEK_START[Math.trunc(type)];
    if (start === undefined || Math.trunc(type) === 3) return fail("#NUM!");
    const january = dateSerial(serialDate(serial).year, 1, 1);
    const offset = (dayOfWeek(january) - start + 7) % 7;
    return Math.floor((Math.floor(serial) - january + offset) / 7) + 1;
  },
  ISOWEEKNUM: numeric((serial) => isoWeek(serial), [1, 1]),
  DAYS: numeric((end, start) => Math.floor(end) - Math.floor(start), [2, 2]),
  EDATE: numeric((start, months) => addMonths(start, months), [2, 2]),
  EOMONTH: numeric(
    (start, months) => {
      const { year, month } = serialDate(start);
      return dateSerial(year, month + Math.trunc(months) + 1, 0);
    },
    [2, 2],
  ),
  NETWORKDAYS: (args) => {
    if (args.length < 2 || args.length > 3) return fail("#VALUE!");
    const start = numberArg(args[0]);
    const end = numberArg(args[1]);
    const holidays = holidayList(args[2]);
    if (isError(start)) return start;
    if (isError(end)) return end;
    if (isError(holidays)) return holidays;
    const [from, to] = [Math.floor(Math.min(start, end)), Math.floor(Math.max(start, end))];
    if (to - from > 200_000) return fail("#NUM!");
    let count = 0;
    for (let day = from; day <= to; day += 1) if (isWorkday(day, holidays)) count += 1;
    return start > end ? -count : count;
  },
  WORKDAY: (args) => {
    if (args.length < 2 || args.length > 3) return fail("#VALUE!");
    const start = numberArg(args[0]);
    const days = numberArg(args[1]);
    const holidays = holidayList(args[2]);
    if (isError(start)) return start;
    if (isError(days)) return days;
    if (isError(holidays)) return holidays;
    let remaining = Math.trunc(days);
    if (Math.abs(remaining) > 100_000) return fail("#NUM!");
    let day = Math.floor(start);
    const step = Math.sign(remaining);
    while (remaining !== 0) {
      day += step;
      if (isWorkday(day, holidays)) remaining -= step;
    }
    return day;
  },
  HOUR: numeric((serial) => Math.floor(secondsOf(serial) / 3600), [1, 1]),
  MINUTE: numeric((serial) => Math.floor(secondsOf(serial) / 60) % 60, [1, 1]),
  SECOND: numeric((serial) => secondsOf(serial) % 60, [1, 1]),
  TIME: numeric(
    (hours, minutes, seconds) => {
      const total = Math.trunc(hours) * 3600 + Math.trunc(minutes) * 60 + Math.trunc(seconds);
      return total < 0 ? fail("#NUM!") : (total % 86_400) / 86_400;
    },
    [3, 3],
  ),
  DATEVALUE: (args) => {
    const text = textArg(args[0]);
    if (isError(text)) return text;
    const parsed = parseInput(text.trim());
    return args.length === 1 && parsed.type === "number" && (parsed.format === "date" || parsed.format === "datetime")
      ? Math.floor(parsed.value)
      : fail("#VALUE!");
  },
  TIMEVALUE: (args) => {
    const text = textArg(args[0]);
    if (isError(text)) return text;
    const parsed = parseInput(text.trim());
    return args.length === 1 && parsed.type === "number" && (parsed.format === "time" || parsed.format === "datetime")
      ? parsed.value - Math.floor(parsed.value)
      : fail("#VALUE!");
  },
  DATEDIF: (args) => {
    if (args.length !== 3) return fail("#VALUE!");
    const startValue = numberArg(args[0]);
    const endValue = numberArg(args[1]);
    const unit = textArg(args[2]);
    if (isError(startValue)) return startValue;
    if (isError(endValue)) return endValue;
    if (isError(unit)) return unit;
    const [start, end] = [Math.floor(startValue), Math.floor(endValue)];
    if (start > end) return fail("#NUM!");
    const a = serialDate(start);
    const b = serialDate(end);
    const months = (b.year - a.year) * 12 + (b.month - a.month) - (b.day < a.day ? 1 : 0);
    switch (unit.toUpperCase()) {
      case "D":
        return end - start;
      case "M":
        return months;
      case "Y":
        return Math.floor(months / 12);
      case "YM":
        return months % 12;
      case "MD":
        return b.day >= a.day ? b.day - a.day : lastDayOfMonth(b.year, b.month - 1) - a.day + b.day;
      case "YD": {
        let shifted = dateSerial(b.year, a.month, Math.min(a.day, lastDayOfMonth(b.year, a.month)));
        if (shifted > end)
          shifted = dateSerial(b.year - 1, a.month, Math.min(a.day, lastDayOfMonth(b.year - 1, a.month)));
        return end - shifted;
      }
      default:
        return fail("#NUM!");
    }
  },
  ISEVEN: numeric((value) => Math.trunc(value) % 2 === 0, [1, 1]),
  ISODD: numeric((value) => Math.abs(Math.trunc(value)) % 2 === 1, [1, 1]),
  ISLOGICAL: (args) => args.length === 1 && typeof scalar(args[0]) === "boolean",
  ISNONTEXT: (args) => args.length === 1 && typeof scalar(args[0]) !== "string",
  ISNA: (args) => {
    const value = args.length === 1 ? scalar(args[0]) : null;
    return isError(value) && value.error === "#N/A";
  },
  ISERR: (args) => {
    const value = args.length === 1 ? scalar(args[0]) : null;
    return isError(value) && value.error !== "#N/A";
  },
} satisfies Record<string, Impl>);

// ---------- Bereiche als Ergebnis (überlaufen in die Nachbarzellen) ----------

const transpose = (grid: Grid): Grid => (grid[0] ?? []).map((_, c) => grid.map((line) => line[c] ?? null));
const integerArg = (arg: Arg | undefined, fallback: number): number | CellError => {
  if (arg === undefined) return fallback;
  const value = scalar(arg);
  if (value === null || value === "") return fallback;
  const number = toNumber(value);
  return isError(number) ? number : Math.trunc(number);
};
const boolArg = (arg: Arg | undefined, fallback: boolean): boolean | CellError => {
  if (arg === undefined) return fallback;
  const value = scalar(arg);
  return value === null || value === "" ? fallback : truthy(value);
};
// Sortierreihenfolge wie Excel: Zahlen, Text, Wahrheitswerte, Fehler; leere Zellen immer zuletzt.
function sortValue(a: Value, b: Value): number {
  const empty = (value: Value) => value === null || value === "";
  if (empty(a) || empty(b)) return empty(a) === empty(b) ? 0 : empty(a) ? 1 : -1;
  if (isError(a) || isError(b)) return isError(a) === isError(b) ? 0 : isError(a) ? 1 : -1;
  return compare(a, b);
}
// Leere Zellen bleiben auch bei absteigender Sortierung am Ende.
const ordered = (a: Value, b: Value, order: number) =>
  a === null || a === "" || b === null || b === "" ? sortValue(a, b) : sortValue(a, b) * order;
const uniqueKey = (line: Value[]) =>
  line
    .map((value) => (typeof value === "string" ? `s${value.toLocaleLowerCase("de-CH")}` : `v${toText(value)}`))
    .join("\u0000");
// Positionen für SPALTENWAHL/ZEILENWAHL (negativ = vom Ende).
function pickIndexes(args: Arg[], count: number): number[] | CellError {
  const out: number[] = [];
  for (const arg of args)
    for (const value of isGrid(arg) ? arg.flat() : [arg]) {
      const number = toNumber(value);
      if (isError(number)) return number;
      const index = Math.trunc(number);
      if (index === 0 || Math.abs(index) > count) return fail("#VALUE!");
      out.push(index > 0 ? index - 1 : count + index);
    }
  return out;
}
// Zeilen oder Spalten am Anfang/Ende nehmen (ÜBERNEHMEN) oder weglassen (WEGLASSEN).
function slice(grid: Grid, rows: number | null, cols: number | null, keep: boolean): Grid {
  const cut = <T>(list: T[], amount: number | null) => {
    if (amount === null) return list;
    if (keep) return amount >= 0 ? list.slice(0, amount) : list.slice(Math.max(0, list.length + amount));
    return amount >= 0 ? list.slice(amount) : list.slice(0, Math.max(0, list.length + amount));
  };
  return cut(grid, rows).map((line) => cut(line, cols));
}
// Gleich breite Zeilen (fehlende Stellen mit #NV, wie VSTAPELN/HSTAPELN).
const padded = (grid: Grid, width: number): Grid =>
  grid.map((line) => [...line, ...Array.from({ length: width - line.length }, () => fail("#N/A"))]);
const emptyResult = (fallback: Arg | undefined): Arg => (fallback === undefined ? fail("#CALC!") : fallback);

// XVERGLEICH/XVERWEIS: Position eines Suchwerts (0 genau, -1/1 nächstkleiner/-grösser, 2 Platzhalter).
function lookupIndex(list: Value[], key: Value, mode: number, direction: number): number {
  const indexes = list.map((_, index) => index);
  if (direction < 0) indexes.reverse();
  if (mode === 0 || mode === 2) {
    const test = matcher(key, mode === 2);
    return indexes.find((index) => test(list[index])) ?? -1;
  }
  let found = -1;
  let best: Value = null;
  for (const index of indexes) {
    const value = list[index];
    if (value === null || isError(value) || typeof value !== typeof key) continue;
    const result = compare(value, key);
    if (result === 0) return index;
    if (
      (mode < 0 ? result < 0 : result > 0) &&
      (best === null || (mode < 0 ? compare(value, best) > 0 : compare(value, best) < 0))
    ) {
      best = value;
      found = index;
    }
  }
  return found;
}

// Zahlungen (Finanzmathematik wie Excel): Rate, Anzahl Perioden, Barwert, Endwert, Fälligkeit (0 Ende, 1 Anfang).
function payment(rate: number, periods: number, present: number, future: number, type: number) {
  if (rate === 0) return -(present + future) / periods;
  const growth = (1 + rate) ** periods;
  return (-(present * growth + future) * rate) / ((1 + rate * type) * (growth - 1));
}
function futureValue(rate: number, periods: number, pay: number, present: number, type: number) {
  if (rate === 0) return -(present + pay * periods);
  const growth = (1 + rate) ** periods;
  return -(present * growth + (pay * (1 + rate * type) * (growth - 1)) / rate);
}
const numberList = (args: Arg[]): number[] | CellError => numbers(args);
function percentile(values: number[], k: number, exclusive: boolean): number | CellError {
  if (!values.length || k < 0 || k > 1) return fail("#NUM!");
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const position = exclusive ? k * (n + 1) - 1 : k * (n - 1);
  if (position < 0 || position > n - 1) return fail("#NUM!");
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + (lower + 1 < n ? fraction * (sorted[lower + 1] - sorted[lower]) : 0);
}
function pairs(args: Arg[]): { xs: number[]; ys: number[] } | CellError {
  if (args.length !== 2) return fail("#VALUE!");
  const ys = isGrid(args[0]) ? args[0].flat() : [args[0]];
  const xs = isGrid(args[1]) ? args[1].flat() : [args[1]];
  if (ys.length !== xs.length) return fail("#N/A");
  const out = { xs: [] as number[], ys: [] as number[] };
  ys.forEach((y, index) => {
    const x = xs[index];
    if (typeof x === "number" && typeof y === "number") {
      out.xs.push(x);
      out.ys.push(y);
    }
  });
  return out;
}
function regression(args: Arg[]) {
  const data = pairs(args);
  if (isError(data)) return data;
  const n = data.xs.length;
  if (n < 2) return fail("#DIV/0!");
  const mx = data.xs.reduce((a, b) => a + b, 0) / n;
  const my = data.ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  data.xs.forEach((x, index) => {
    sxy += (x - mx) * (data.ys[index] - my);
    sxx += (x - mx) ** 2;
    syy += (data.ys[index] - my) ** 2;
  });
  if (sxx === 0) return fail("#DIV/0!");
  return { slope: sxy / sxx, intercept: my - (sxy / sxx) * mx, sxy, sxx, syy };
}
const ROMAN: [number, string][] = [
  [1000, "M"],
  [900, "CM"],
  [500, "D"],
  [400, "CD"],
  [100, "C"],
  [90, "XC"],
  [50, "L"],
  [40, "XL"],
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];
const factorial = (n: number) => {
  let out = 1;
  for (let i = 2; i <= n; i += 1) out *= i;
  return out;
};
// Wochenende für NETTOARBEITSTAGE.INTL/ARBEITSTAG.INTL: Nummer (1 = Sa/So, 11 = nur So …) oder „0000011“.
function weekendOf(arg: Arg | undefined): Set<number> | CellError {
  if (arg === undefined) return new Set([0, 6]);
  const value = scalar(arg);
  if (typeof value === "string" && /^[01]{7}$/.test(value)) {
    const days = new Set<number>();
    [...value].forEach((flag, index) => flag === "1" && days.add((index + 1) % 7));
    return days.size === 7 ? fail("#VALUE!") : days;
  }
  const number = toNumber(value);
  if (isError(number)) return number;
  const code = Math.trunc(number);
  if (code >= 1 && code <= 7) return new Set([(code + 5) % 7, (code + 6) % 7]);
  if (code >= 11 && code <= 17) return new Set([(code - 10) % 7]);
  return fail("#NUM!");
}

Object.assign(FUNCTIONS, {
  FILTER: (args) => {
    if (args.length < 2 || args.length > 3) return fail("#VALUE!");
    const grid = toGrid(args[0]);
    const include = toGrid(args[1]);
    const byRows = include.length === grid.length && (include[0]?.length ?? 0) === 1;
    const byCols = include.length === 1 && (include[0]?.length ?? 0) === (grid[0]?.length ?? 0);
    if (!byRows && !byCols) return fail("#VALUE!");
    const keep: boolean[] = [];
    for (const value of include.flat()) {
      const test = truthy(value);
      if (isError(test)) return test;
      keep.push(test);
    }
    const result = byRows ? grid.filter((_, r) => keep[r]) : grid.map((line) => line.filter((_, c) => keep[c]));
    return result.length && result[0]?.length ? result : emptyResult(args[2]);
  },
  SORT: (args) => {
    if (args.length < 1 || args.length > 4) return fail("#VALUE!");
    const index = integerArg(args[1], 1);
    const order = integerArg(args[2], 1);
    const byCol = boolArg(args[3], false);
    if (isError(index)) return index;
    if (isError(order)) return order;
    if (isError(byCol)) return byCol;
    const grid = byCol ? transpose(toGrid(args[0])) : toGrid(args[0]);
    if (index < 1 || index > (grid[0]?.length ?? 0) || (order !== 1 && order !== -1)) return fail("#VALUE!");
    const sorted = grid
      .map((line, position) => ({ line, position }))
      .sort((a, b) => ordered(a.line[index - 1], b.line[index - 1], order) || a.position - b.position)
      .map((item) => item.line);
    return byCol ? transpose(sorted) : sorted;
  },
  SORTBY: (args) => {
    if (args.length < 2) return fail("#VALUE!");
    const grid = toGrid(args[0]);
    const keys: { values: Value[]; order: number }[] = [];
    for (let index = 1; index < args.length; index += 2) {
      const values = vector(args[index]);
      const order = integerArg(args[index + 1], 1);
      if (isError(order)) return order;
      if (!values || values.length !== grid.length || (order !== 1 && order !== -1)) return fail("#VALUE!");
      keys.push({ values, order });
    }
    return grid
      .map((line, position) => ({ line, position }))
      .sort((a, b) => {
        for (const key of keys) {
          const result = ordered(key.values[a.position], key.values[b.position], key.order);
          if (result) return result;
        }
        return a.position - b.position;
      })
      .map((item) => item.line);
  },
  UNIQUE: (args) => {
    if (args.length < 1 || args.length > 3) return fail("#VALUE!");
    const byCol = boolArg(args[1], false);
    const once = boolArg(args[2], false);
    if (isError(byCol)) return byCol;
    if (isError(once)) return once;
    const grid = byCol ? transpose(toGrid(args[0])) : toGrid(args[0]);
    const counts = new Map<string, number>();
    for (const line of grid) counts.set(uniqueKey(line), (counts.get(uniqueKey(line)) ?? 0) + 1);
    const seen = new Set<string>();
    const result = grid.filter((line) => {
      const key = uniqueKey(line);
      if (seen.has(key) || (once && counts.get(key)! > 1)) return false;
      seen.add(key);
      return true;
    });
    if (!result.length) return fail("#CALC!");
    return byCol ? transpose(result) : result;
  },
  SEQUENCE: (args) => {
    if (args.length < 1 || args.length > 4) return fail("#VALUE!");
    const values = [integerArg(args[0], 1), integerArg(args[1], 1)];
    const start = args[2] === undefined || scalar(args[2]) === "" ? 1 : toNumber(scalar(args[2]));
    const step = args[3] === undefined || scalar(args[3]) === "" ? 1 : toNumber(scalar(args[3]));
    for (const value of [...values, start, step]) if (isError(value)) return value;
    const [rows, cols] = values as number[];
    if (rows < 1 || cols < 1) return fail("#CALC!");
    if (rows * cols > 200_000) return fail("#NUM!");
    return Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => precise((start as number) + (r * cols + c) * (step as number))),
    );
  },
  TRANSPOSE: (args) => (args.length === 1 ? transpose(toGrid(args[0])) : fail("#VALUE!")),
  RANDARRAY: (args) => {
    if (args.length > 5) return fail("#VALUE!");
    const rows = integerArg(args[0], 1);
    const cols = integerArg(args[1], 1);
    const min = args[2] === undefined ? 0 : toNumber(scalar(args[2]));
    const max = args[3] === undefined ? 1 : toNumber(scalar(args[3]));
    const whole = boolArg(args[4], false);
    for (const value of [rows, cols, min, max, whole]) if (isError(value)) return value;
    const [r, c, lo, hi] = [rows, cols, min, max] as number[];
    if (r < 1 || c < 1 || lo > hi || r * c > 200_000) return fail("#VALUE!");
    return Array.from({ length: r }, () =>
      Array.from({ length: c }, () =>
        whole
          ? Math.ceil(lo) + Math.floor(Math.random() * (Math.floor(hi) - Math.ceil(lo) + 1))
          : lo + Math.random() * (hi - lo),
      ),
    );
  },
  XMATCH: (args) => {
    if (args.length < 2 || args.length > 4) return fail("#VALUE!");
    const key = scalar(args[0]);
    if (isError(key)) return key;
    const list = vector(args[1]);
    const mode = integerArg(args[2], 0);
    const direction = integerArg(args[3], 1);
    if (!list) return fail("#VALUE!");
    if (isError(mode)) return mode;
    if (isError(direction)) return direction;
    const found = lookupIndex(list, key, mode, direction);
    return found < 0 ? fail("#N/A") : found + 1;
  },
  TEXTSPLIT: (args) => {
    if (args.length < 2 || args.length > 6) return fail("#VALUE!");
    const text = textArg(args[0]);
    if (isError(text)) return text;
    const delimiters = (arg: Arg | undefined) =>
      arg === undefined ? [] : (isGrid(arg) ? arg.flat() : [arg]).map(toText).filter((item) => item !== "");
    const colDelims = delimiters(args[1]);
    const rowDelims = delimiters(args[2]);
    const ignore = boolArg(args[3], false);
    const caseless = integerArg(args[4], 0);
    if (isError(ignore)) return ignore;
    if (isError(caseless)) return caseless;
    const pad = args[5] === undefined ? fail("#N/A") : scalar(args[5]);
    const split = (value: string, list: string[]) => {
      if (!list.length) return [value];
      const pattern = new RegExp(
        list.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
        caseless ? "i" : "",
      );
      const parts = value.split(pattern);
      return ignore ? parts.filter((part) => part !== "") : parts;
    };
    const rows = split(text, rowDelims).map((line) => split(line, colDelims));
    const width = Math.max(...rows.map((line) => line.length));
    return rows.map((line) => [...line, ...Array.from({ length: width - line.length }, () => pad)]);
  },
  VSTACK: (args) => {
    if (!args.length) return fail("#VALUE!");
    const grids = args.map(toGrid);
    const width = Math.max(...grids.map((grid) => grid[0]?.length ?? 0));
    return grids.flatMap((grid) => padded(grid, width));
  },
  HSTACK: (args) => {
    if (!args.length) return fail("#VALUE!");
    const grids = args.map(toGrid);
    const height = Math.max(...grids.map((grid) => grid.length));
    return transpose(grids.flatMap((grid) => padded(transpose(grid), height)));
  },
  TAKE: (args) => {
    if (args.length < 2 || args.length > 3) return fail("#VALUE!");
    const rows = args[1] === undefined || scalar(args[1]) === "" ? null : integerArg(args[1], 0);
    const cols = args[2] === undefined || scalar(args[2]) === "" ? null : integerArg(args[2], 0);
    if (rows !== null && isError(rows)) return rows;
    if (cols !== null && isError(cols)) return cols;
    if (rows === 0 || cols === 0) return fail("#CALC!");
    const result = slice(toGrid(args[0]), rows, cols, true);
    return result.length && result[0]?.length ? result : fail("#CALC!");
  },
  DROP: (args) => {
    if (args.length < 2 || args.length > 3) return fail("#VALUE!");
    const rows = args[1] === undefined || scalar(args[1]) === "" ? null : integerArg(args[1], 0);
    const cols = args[2] === undefined || scalar(args[2]) === "" ? null : integerArg(args[2], 0);
    if (rows !== null && isError(rows)) return rows;
    if (cols !== null && isError(cols)) return cols;
    const result = slice(toGrid(args[0]), rows, cols, false);
    return result.length && result[0]?.length ? result : fail("#CALC!");
  },
  CHOOSECOLS: (args) => {
    if (args.length < 2) return fail("#VALUE!");
    const grid = toGrid(args[0]);
    const picked = pickIndexes(args.slice(1), grid[0]?.length ?? 0);
    return isError(picked) ? picked : grid.map((line) => picked.map((index) => line[index]));
  },
  CHOOSEROWS: (args) => {
    if (args.length < 2) return fail("#VALUE!");
    const grid = toGrid(args[0]);
    const picked = pickIndexes(args.slice(1), grid.length);
    return isError(picked) ? picked : picked.map((index) => grid[index]);
  },
  TOCOL: (args) => {
    if (args.length < 1 || args.length > 3) return fail("#VALUE!");
    const ignore = integerArg(args[1], 0);
    const byCol = boolArg(args[2], false);
    if (isError(ignore)) return ignore;
    if (isError(byCol)) return byCol;
    const grid = toGrid(args[0]);
    const values = (byCol ? transpose(grid) : grid)
      .flat()
      .filter(
        (value) =>
          !((ignore === 1 || ignore === 3) && (value === null || value === "")) &&
          !((ignore === 2 || ignore === 3) && isError(value)),
      );
    return values.length ? values.map((value) => [value]) : fail("#CALC!");
  },
  TOROW: (args, resolver) => {
    const column = FUNCTIONS.TOCOL(args, resolver);
    return isGrid(column) ? transpose(column) : column;
  },
  EXPAND: (args) => {
    if (args.length < 2 || args.length > 4) return fail("#VALUE!");
    const grid = toGrid(args[0]);
    const rows = integerArg(args[1], grid.length);
    const cols = integerArg(args[2], grid[0]?.length ?? 0);
    if (isError(rows)) return rows;
    if (isError(cols)) return cols;
    if (rows < grid.length || cols < (grid[0]?.length ?? 0)) return fail("#VALUE!");
    const pad = args[3] === undefined ? fail("#N/A") : scalar(args[3]);
    return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, c) => grid[r]?.[c] ?? pad));
  },
  WRAPROWS: (args) => {
    const list = vector(args[0] ?? null);
    const width = integerArg(args[1], 0);
    if (!list || args.length < 2) return fail("#VALUE!");
    if (isError(width)) return width;
    if (width < 1) return fail("#NUM!");
    const pad = args[2] === undefined ? fail("#N/A") : scalar(args[2]);
    const out: Grid = [];
    for (let index = 0; index < list.length; index += width)
      out.push(Array.from({ length: width }, (_, c) => (index + c < list.length ? list[index + c] : pad)));
    return out;
  },
  WRAPCOLS: (args, resolver) => {
    const rows = FUNCTIONS.WRAPROWS(args, resolver);
    return isGrid(rows) ? transpose(rows) : rows;
  },
  MMULT: (args) => {
    if (args.length !== 2) return fail("#VALUE!");
    const [a, b] = [toGrid(args[0]), toGrid(args[1])];
    if ((a[0]?.length ?? 0) !== b.length) return fail("#VALUE!");
    if ([...a.flat(), ...b.flat()].some((value) => typeof value !== "number")) return fail("#VALUE!");
    return a.map((line) =>
      (b[0] ?? []).map((_, c) =>
        line.reduce<number>((sum, value, k) => sum + (value as number) * (b[k][c] as number), 0),
      ),
    );
  },
  FREQUENCY: (args) => {
    if (args.length !== 2) return fail("#VALUE!");
    const data = numbers([args[0]]);
    const bins = numbers([args[1]]);
    if (isError(data)) return data;
    if (isError(bins)) return bins;
    const edges = [...bins].sort((a, b) => a - b);
    const counts = Array.from({ length: edges.length + 1 }, () => 0);
    for (const value of data) {
      const at = edges.findIndex((edge) => value <= edge);
      counts[at < 0 ? edges.length : at] += 1;
    }
    // Reihenfolge der Klassen wie angegeben.
    return [...bins.map((bin) => [counts[edges.indexOf(bin)]]), [counts[edges.length]]];
  },

  // Finanzmathematik
  PMT: numeric(
    (rate, periods, present, future = 0, type = 0) =>
      periods === 0 ? fail("#NUM!") : payment(rate, periods, present, future, type ? 1 : 0),
    [3, 5],
  ),
  FV: numeric(
    (rate, periods, pay, present = 0, type = 0) => futureValue(rate, periods, pay, present, type ? 1 : 0),
    [3, 5],
  ),
  PV: numeric(
    (rate, periods, pay, future = 0, type = 0) => {
      if (rate === 0) return -(future + pay * periods);
      const growth = (1 + rate) ** periods;
      return -(future + (pay * (1 + rate * (type ? 1 : 0)) * (growth - 1)) / rate) / growth;
    },
    [3, 5],
  ),
  NPER: numeric(
    (rate, pay, present, future = 0, type = 0) => {
      if (rate === 0) return pay === 0 ? fail("#NUM!") : -(present + future) / pay;
      const t = type ? 1 : 0;
      const numerator = pay * (1 + rate * t) - future * rate;
      const denominator = present * rate + pay * (1 + rate * t);
      if (numerator / denominator <= 0) return fail("#NUM!");
      return Math.log(numerator / denominator) / Math.log(1 + rate);
    },
    [3, 5],
  ),
  RATE: numeric(
    (periods, pay, present, future = 0, type = 0, guess = 0.1) => {
      // Nullstelle von „Endwert der Zahlungen + Endwert = 0“ (Newton-Verfahren).
      const balance = (rate: number) => future - futureValue(rate, periods, pay, present, type ? 1 : 0);
      let rate = guess;
      for (let step = 0; step < 100; step += 1) {
        const value = balance(rate);
        const delta = 1e-7;
        const slope = (balance(rate + delta) - value) / delta;
        if (slope === 0 || !Number.isFinite(slope)) return fail("#NUM!");
        const next = rate - value / slope;
        if (Math.abs(next - rate) < 1e-10) return next;
        rate = next;
      }
      return fail("#NUM!");
    },
    [3, 6],
  ),
  IPMT: numeric(
    (rate, period, periods, present, future = 0, type = 0) => {
      if (period < 1 || period > periods) return fail("#NUM!");
      const t = type ? 1 : 0;
      if (period === 1 && t === 1) return 0;
      const pay = payment(rate, periods, present, future, t);
      const balance = -futureValue(rate, period - 1, pay, present, t);
      return -(t === 1 ? (balance - pay) * rate : balance * rate);
    },
    [4, 6],
  ),
  PPMT: numeric(
    (rate, period, periods, present, future = 0, type = 0) => {
      if (period < 1 || period > periods) return fail("#NUM!");
      const t = type ? 1 : 0;
      const pay = payment(rate, periods, present, future, t);
      if (period === 1 && t === 1) return pay;
      const balance = -futureValue(rate, period - 1, pay, present, t);
      return pay + (t === 1 ? (balance - pay) * rate : balance * rate);
    },
    [4, 6],
  ),
  NPV: (args) => {
    if (args.length < 2) return fail("#VALUE!");
    const rate = toNumber(scalar(args[0]));
    const values = numberList(args.slice(1));
    if (isError(rate)) return rate;
    if (isError(values)) return values;
    return values.reduce((sum, value, index) => sum + value / (1 + rate) ** (index + 1), 0);
  },
  IRR: (args) => {
    if (args.length < 1 || args.length > 2) return fail("#VALUE!");
    const values = numberList([args[0]]);
    const guess = args[1] === undefined ? 0.1 : toNumber(scalar(args[1]));
    if (isError(values)) return values;
    if (isError(guess)) return guess;
    if (!values.some((value) => value > 0) || !values.some((value) => value < 0)) return fail("#NUM!");
    let rate = guess;
    for (let step = 0; step < 200; step += 1) {
      let npv = 0;
      let slope = 0;
      values.forEach((value, index) => {
        npv += value / (1 + rate) ** index;
        slope -= (index * value) / (1 + rate) ** (index + 1);
      });
      if (slope === 0) return fail("#NUM!");
      const next = rate - npv / slope;
      if (Math.abs(next - rate) < 1e-12) return next;
      rate = next;
    }
    return fail("#NUM!");
  },

  // Statistik
  "PERCENTILE.INC": (args) => {
    const values = numberList([args[0] ?? null]);
    const k = numberArg(args[1]);
    if (isError(values)) return values;
    if (isError(k)) return k;
    return args.length === 2 ? percentile(values, k, false) : fail("#VALUE!");
  },
  "PERCENTILE.EXC": (args) => {
    const values = numberList([args[0] ?? null]);
    const k = numberArg(args[1]);
    if (isError(values)) return values;
    if (isError(k)) return k;
    return args.length === 2 ? percentile(values, k, true) : fail("#VALUE!");
  },
  "QUARTILE.INC": (args) => {
    const values = numberList([args[0] ?? null]);
    const q = numberArg(args[1]);
    if (isError(values)) return values;
    if (isError(q)) return q;
    return args.length === 2 && q >= 0 && q <= 4 ? percentile(values, Math.trunc(q) / 4, false) : fail("#NUM!");
  },
  "RANK.AVG": (args) => {
    if (args.length < 2 || args.length > 3 || !isGrid(args[1])) return fail("#VALUE!");
    const value = numberArg(args[0]);
    const order = numberArg(args[2], 0);
    const values = numbers([args[1]]);
    if (isError(value)) return value;
    if (isError(order)) return order;
    if (isError(values)) return values;
    const same = values.filter((other) => other === value).length;
    if (!same) return fail("#N/A");
    const better = values.filter((other) => (order ? other < value : other > value)).length;
    return better + (same + 1) / 2;
  },
  CORREL: (args) => {
    const fit = regression(args);
    if (isError(fit)) return fit;
    return fit.syy === 0 ? fail("#DIV/0!") : fit.sxy / Math.sqrt(fit.sxx * fit.syy);
  },
  RSQ: (args) => {
    const fit = regression(args);
    if (isError(fit)) return fit;
    return fit.syy === 0 ? fail("#DIV/0!") : fit.sxy ** 2 / (fit.sxx * fit.syy);
  },
  SLOPE: (args) => {
    const fit = regression(args);
    return isError(fit) ? fit : fit.slope;
  },
  INTERCEPT: (args) => {
    const fit = regression(args);
    return isError(fit) ? fit : fit.intercept;
  },
  "FORECAST.LINEAR": (args) => {
    if (args.length !== 3) return fail("#VALUE!");
    const x = numberArg(args[0]);
    const fit = regression(args.slice(1));
    if (isError(x)) return x;
    return isError(fit) ? fit : fit.intercept + fit.slope * x;
  },
  "COVARIANCE.P": (args) => {
    const data = pairs(args);
    if (isError(data)) return data;
    const n = data.xs.length;
    if (!n) return fail("#DIV/0!");
    const mx = data.xs.reduce((a, b) => a + b, 0) / n;
    const my = data.ys.reduce((a, b) => a + b, 0) / n;
    return data.xs.reduce((sum, x, index) => sum + (x - mx) * (data.ys[index] - my), 0) / n;
  },
  GEOMEAN: aggregate((values) =>
    !values.length || values.some((value) => value <= 0)
      ? fail("#NUM!")
      : Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length),
  ),
  HARMEAN: aggregate((values) =>
    !values.length || values.some((value) => value <= 0)
      ? fail("#NUM!")
      : values.length / values.reduce((sum, value) => sum + 1 / value, 0),
  ),
  AVEDEV: aggregate((values) => {
    if (!values.length) return fail("#NUM!");
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    return values.reduce((sum, value) => sum + Math.abs(value - mean), 0) / values.length;
  }),
  AVERAGEA: (args) => {
    const values = flat(args).filter((value) => value !== null);
    if (!values.length) return fail("#DIV/0!");
    let sum = 0;
    for (const value of values) {
      if (isError(value)) return value;
      sum += typeof value === "number" ? value : value === true ? 1 : 0;
    }
    return sum / values.length;
  },
  MAXA: (args) => {
    const values = flat(args).filter((value) => value !== null);
    const problem = values.find(isError);
    if (problem) return problem;
    return values.length
      ? Math.max(...values.map((value) => (typeof value === "number" ? value : value === true ? 1 : 0)))
      : 0;
  },
  MINA: (args) => {
    const values = flat(args).filter((value) => value !== null);
    const problem = values.find(isError);
    if (problem) return problem;
    return values.length
      ? Math.min(...values.map((value) => (typeof value === "number" ? value : value === true ? 1 : 0)))
      : 0;
  },
  "NORM.DIST": numeric(
    (x, mean, sd, cumulative) => {
      if (sd <= 0) return fail("#NUM!");
      const z = (x - mean) / sd;
      if (!cumulative) return Math.exp((-z * z) / 2) / (sd * Math.sqrt(2 * Math.PI));
      return 0.5 * (1 + erf(z / Math.SQRT2));
    },
    [4, 4],
  ),

  // Mathematik
  FACT: numeric((value) => (value < 0 ? fail("#NUM!") : factorial(Math.trunc(value))), [1, 1]),
  COMBIN: numeric(
    (n, k) => {
      const [a, b] = [Math.trunc(n), Math.trunc(k)];
      if (a < 0 || b < 0 || b > a) return fail("#NUM!");
      let out = 1;
      for (let i = 1; i <= b; i += 1) out = (out * (a - b + i)) / i;
      return Math.round(out);
    },
    [2, 2],
  ),
  PERMUT: numeric(
    (n, k) => {
      const [a, b] = [Math.trunc(n), Math.trunc(k)];
      if (a < 0 || b < 0 || b > a) return fail("#NUM!");
      let out = 1;
      for (let i = 0; i < b; i += 1) out *= a - i;
      return out;
    },
    [2, 2],
  ),
  "CEILING.MATH": numeric(
    (value, step = 1, mode = 0) => {
      if (step === 0) return 0;
      const size = Math.abs(step);
      if (value < 0 && mode) return -Math.ceil(precise(-value / size)) * size;
      return precise(Math.ceil(precise(value / size)) * size);
    },
    [1, 3],
  ),
  "FLOOR.MATH": numeric(
    (value, step = 1, mode = 0) => {
      if (step === 0) return 0;
      const size = Math.abs(step);
      if (value < 0 && mode) return -Math.floor(precise(-value / size)) * size;
      return precise(Math.floor(precise(value / size)) * size);
    },
    [1, 3],
  ),
  ASIN: numeric((value) => (Math.abs(value) > 1 ? fail("#NUM!") : Math.asin(value)), [1, 1]),
  ACOS: numeric((value) => (Math.abs(value) > 1 ? fail("#NUM!") : Math.acos(value)), [1, 1]),
  ATAN: numeric((value) => Math.atan(value), [1, 1]),
  ATAN2: numeric((x, y) => (x === 0 && y === 0 ? fail("#DIV/0!") : Math.atan2(y, x)), [2, 2]),
  ROMAN: numeric(
    (value) => {
      let rest = Math.trunc(value);
      if (rest < 0 || rest > 3999) return fail("#VALUE!");
      let out = "";
      for (const [amount, letters] of ROMAN)
        while (rest >= amount) {
          out += letters;
          rest -= amount;
        }
      return out;
    },
    [1, 2],
  ),
  ARABIC: textual(
    (text) => {
      const source = text.trim().toUpperCase();
      if (!/^-?[MDCLXVI]*$/.test(source)) return fail("#VALUE!");
      const sign = source.startsWith("-") ? -1 : 1;
      const letters = source.replace("-", "");
      const value: Record<string, number> = { M: 1000, D: 500, C: 100, L: 50, X: 10, V: 5, I: 1 };
      let total = 0;
      for (let i = 0; i < letters.length; i += 1) {
        const current = value[letters[i]];
        total += current < (value[letters[i + 1]] ?? 0) ? -current : current;
      }
      return sign * total;
    },
    [1, 1],
  ),
  BASE: numeric(
    (value, radix, length = 0) => {
      if (value < 0 || radix < 2 || radix > 36) return fail("#NUM!");
      return Math.trunc(value).toString(Math.trunc(radix)).toUpperCase().padStart(Math.trunc(length), "0");
    },
    [2, 3],
  ),
  DECIMAL: (args) => {
    if (args.length !== 2) return fail("#VALUE!");
    const text = textArg(args[0]);
    const radix = numberArg(args[1]);
    if (isError(text)) return text;
    if (isError(radix)) return radix;
    const base = Math.trunc(radix);
    if (base < 2 || base > 36) return fail("#NUM!");
    const digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ".slice(0, base);
    const clean = text.trim().toUpperCase();
    if (!clean || [...clean].some((char) => !digits.includes(char))) return fail("#NUM!");
    return parseInt(clean, base);
  },
  DEC2BIN: numeric(
    (value, places = 0) => {
      if (value < -512 || value > 511) return fail("#NUM!");
      const bits = (Math.trunc(value) >>> 0)
        .toString(2)
        .slice(-10)
        .replace(/^0+(?=.)/, "");
      return value < 0 ? bits : bits.padStart(Math.trunc(places), "0");
    },
    [1, 2],
  ),
  BIN2DEC: textual(
    (text) =>
      /^[01]{1,10}$/.test(text.trim())
        ? text.trim().length === 10 && text.trim()[0] === "1"
          ? parseInt(text.trim(), 2) - 1024
          : parseInt(text.trim(), 2)
        : fail("#NUM!"),
    [1, 1],
  ),
  DEC2HEX: numeric(
    (value, places = 0) =>
      Math.trunc(value) >= 0
        ? Math.trunc(value).toString(16).toUpperCase().padStart(Math.trunc(places), "0")
        : fail("#NUM!"),
    [1, 2],
  ),
  HEX2DEC: textual(
    (text) => (/^[0-9A-Fa-f]{1,10}$/.test(text.trim()) ? parseInt(text.trim(), 16) : fail("#NUM!")),
    [1, 1],
  ),
  TRUE: (args) => (args.length ? fail("#VALUE!") : true),
  FALSE: (args) => (args.length ? fail("#VALUE!") : false),

  // Text
  FIXED: numeric(
    (value, digits = 2, noCommas = 0) => {
      const places = Math.trunc(digits);
      const rounded = round(value, places, "half");
      const text = new Intl.NumberFormat("de-CH", {
        minimumFractionDigits: Math.max(0, places),
        maximumFractionDigits: Math.max(0, places),
        useGrouping: !noCommas,
      }).format(rounded);
      return text.replace(/['’  ]/g, "’");
    },
    [1, 3],
  ),
  UNICHAR: numeric(
    (code) => (code < 1 || code > 0x10ffff ? fail("#VALUE!") : String.fromCodePoint(Math.trunc(code))),
    [1, 1],
  ),
  UNICODE: textual((text) => (text ? (text.codePointAt(0) ?? 0) : fail("#VALUE!")), [1, 1]),
  T: (args) => {
    const value = scalar(args[0] ?? null);
    return isError(value) ? value : typeof value === "string" ? value : "";
  },
  N: (args) => {
    const value = scalar(args[0] ?? null);
    return isError(value) ? value : typeof value === "number" ? value : value === true ? 1 : 0;
  },
  NUMBERVALUE: (args) => {
    if (args.length < 1 || args.length > 3) return fail("#VALUE!");
    const text = textArg(args[0]);
    const decimal = textArg(args[1], ".");
    const group = textArg(args[2], "’'");
    if (isError(text)) return text;
    if (isError(decimal)) return decimal;
    if (isError(group)) return group;
    let clean = text.replace(/\s/g, "");
    for (const char of group) clean = clean.split(char).join("");
    if (decimal) clean = clean.split(decimal[0]).join(".");
    const percent = clean.endsWith("%");
    const number = Number(percent ? clean.slice(0, -1) : clean);
    return clean === "" ? 0 : Number.isFinite(number) ? (percent ? number / 100 : number) : fail("#VALUE!");
  },
  TEXTBEFORE: (args) => textAround(args, true),
  TEXTAFTER: (args) => textAround(args, false),

  // Datum
  YEARFRAC: numeric(
    (start, end, basis = 0) => {
      const [a, b] = [Math.floor(Math.min(start, end)), Math.floor(Math.max(start, end))];
      const kind = Math.trunc(basis);
      if (kind === 1) {
        const from = serialDate(a).year;
        const to = serialDate(b).year;
        let days = 0;
        for (let year = from; year <= to; year += 1) days += dateSerial(year + 1, 1, 1) - dateSerial(year, 1, 1);
        return (b - a) / (days / (to - from + 1));
      }
      if (kind === 2) return (b - a) / 360;
      if (kind === 3) return (b - a) / 365;
      if (kind !== 0 && kind !== 4) return fail("#NUM!");
      return days360(a, b, kind === 4) / 360;
    },
    [2, 3],
  ),
  DAYS360: numeric(
    (start, end, european = 0) => days360(Math.floor(start), Math.floor(end), Boolean(european)),
    [2, 3],
  ),
  "NETWORKDAYS.INTL": (args) => {
    if (args.length < 2 || args.length > 4) return fail("#VALUE!");
    const start = numberArg(args[0]);
    const end = numberArg(args[1]);
    const weekend = weekendOf(args[2]);
    const holidays = holidayList(args[3]);
    if (isError(start)) return start;
    if (isError(end)) return end;
    if (isError(weekend)) return weekend;
    if (isError(holidays)) return holidays;
    const [from, to] = [Math.floor(Math.min(start, end)), Math.floor(Math.max(start, end))];
    if (to - from > 200_000) return fail("#NUM!");
    let count = 0;
    for (let day = from; day <= to; day += 1) if (!weekend.has(dayOfWeek(day)) && !holidays.has(day)) count += 1;
    return start > end ? -count : count;
  },
  "WORKDAY.INTL": (args) => {
    if (args.length < 2 || args.length > 4) return fail("#VALUE!");
    const start = numberArg(args[0]);
    const days = numberArg(args[1]);
    const weekend = weekendOf(args[2]);
    const holidays = holidayList(args[3]);
    if (isError(start)) return start;
    if (isError(days)) return days;
    if (isError(weekend)) return weekend;
    if (isError(holidays)) return holidays;
    let remaining = Math.trunc(days);
    if (Math.abs(remaining) > 100_000) return fail("#NUM!");
    let day = Math.floor(start);
    const step = Math.sign(remaining);
    while (remaining !== 0) {
      day += step;
      if (!weekend.has(dayOfWeek(day)) && !holidays.has(day)) remaining -= step;
    }
    return day;
  },

  // Information
  TYPE: (args) => {
    if (args.length !== 1) return fail("#VALUE!");
    const value = args[0];
    if (isGrid(value) && !(value.length === 1 && value[0].length === 1)) return 64;
    const single = scalar(value);
    if (isError(single)) return 16;
    return typeof single === "number" || single === null ? 1 : typeof single === "string" ? 2 : 4;
  },
  "ERROR.TYPE": (args) => {
    const value = scalar(args[0] ?? null);
    const codes: Partial<Record<ErrorCode, number>> = {
      "#DIV/0!": 2,
      "#VALUE!": 3,
      "#REF!": 4,
      "#NAME?": 5,
      "#NUM!": 6,
      "#N/A": 7,
      "#SPILL!": 9,
      "#CALC!": 14,
    };
    return isError(value) ? (codes[value.error] ?? fail("#N/A")) : fail("#N/A");
  },
  // Für die Prüfung „gibt es die Funktion?“ – berechnet werden sie in evaluateCall.
  INDIRECT: () => fail("#REF!"),
  OFFSET: () => fail("#REF!"),
  ISREF: () => false,
  ISFORMULA: () => false,
  FORMULATEXT: () => fail("#N/A"),
  SUBTOTAL: () => fail("#VALUE!"),
  LET: () => fail("#VALUE!"),
  LAMBDA: () => fail("#CALC!"),
  ISOMITTED: () => fail("#VALUE!"),
  ANCHORARRAY: () => fail("#REF!"),
  MAP: () => fail("#VALUE!"),
  REDUCE: () => fail("#VALUE!"),
  SCAN: () => fail("#VALUE!"),
  BYROW: () => fail("#VALUE!"),
  BYCOL: () => fail("#VALUE!"),
  MAKEARRAY: () => fail("#VALUE!"),
} satisfies Record<string, Impl>);

// Fehlerfunktion: Reihe für kleine Werte, Kettenbruch für grosse (Genauigkeit besser als 1e-12).
function erf(x: number): number {
  const a = Math.abs(x);
  if (a < 3) {
    let term = a;
    let sum = a;
    for (let n = 1; n < 200 && Math.abs(term) > 1e-17 * Math.abs(sum); n += 1) {
      term *= (-a * a) / n;
      sum += term / (2 * n + 1);
    }
    return Math.sign(x) * ((2 / Math.sqrt(Math.PI)) * sum);
  }
  let fraction = 0;
  for (let n = 60; n >= 1; n -= 1) fraction = n / 2 / (a + fraction);
  const erfc = Math.exp(-a * a) / Math.sqrt(Math.PI) / (a + fraction);
  return Math.sign(x) * (1 - erfc);
}

// TEXTVOR/TEXTNACH: Text vor bzw. nach dem n-ten Trennzeichen (negativ = vom Ende).
function textAround(args: Arg[], before: boolean): Value {
  if (args.length < 2 || args.length > 6) return fail("#VALUE!");
  const text = textArg(args[0]);
  const delimiter = textArg(args[1]);
  const instance = integerArg(args[2], 1);
  const caseless = integerArg(args[3], 0);
  if (isError(text)) return text;
  if (isError(delimiter)) return delimiter;
  if (isError(instance)) return instance;
  if (isError(caseless)) return caseless;
  if (instance === 0) return fail("#VALUE!");
  const haystack = caseless ? text.toLocaleLowerCase("de-CH") : text;
  const needle = caseless ? delimiter.toLocaleLowerCase("de-CH") : delimiter;
  const positions: number[] = [];
  for (let at = haystack.indexOf(needle); at >= 0 && needle; at = haystack.indexOf(needle, at + needle.length))
    positions.push(at);
  if (!needle) positions.push(...(instance > 0 ? [0] : [text.length]));
  const at = instance > 0 ? positions[instance - 1] : positions[positions.length + instance];
  if (at === undefined) return args[5] !== undefined ? scalar(args[5]) : fail("#N/A");
  return before ? text.slice(0, at) : text.slice(at + needle.length);
}
// TAGE360: US-Methode (NASD) oder europäische Methode.
function days360(start: number, end: number, european: boolean) {
  const a = serialDate(start);
  const b = serialDate(end);
  let d1 = a.day;
  let d2 = b.day;
  if (european) {
    if (d1 === 31) d1 = 30;
    if (d2 === 31) d2 = 30;
  } else {
    const lastFeb = (date: { year: number; month: number; day: number }) =>
      date.month === 2 && date.day === lastDayOfMonth(date.year, 2);
    if (lastFeb(a) && lastFeb(b)) d2 = 30;
    if (lastFeb(a)) d1 = 30;
    if (d2 === 31 && d1 >= 30) d2 = 30;
    if (d1 === 31) d1 = 30;
  }
  return (b.year - a.year) * 360 + (b.month - a.month) * 30 + (d2 - d1);
}

// Deutsche Namen (wie im deutschen Excel) → interne englische Namen; beide Schreibweisen funktionieren.
const GERMAN: Record<string, string> = {
  SUMME: "SUM",
  MITTELWERT: "AVERAGE",
  PRODUKT: "PRODUCT",
  ANZAHL: "COUNT",
  ANZAHL2: "COUNTA",
  ANZAHLLEEREZELLEN: "COUNTBLANK",
  SUMMEWENN: "SUMIF",
  ZÄHLENWENN: "COUNTIF",
  MITTELWERTWENN: "AVERAGEIF",
  WENN: "IF",
  WENNFEHLER: "IFERROR",
  UND: "AND",
  ODER: "OR",
  NICHT: "NOT",
  RUNDEN: "ROUND",
  AUFRUNDEN: "ROUNDUP",
  ABRUNDEN: "ROUNDDOWN",
  GANZZAHL: "INT",
  REST: "MOD",
  POTENZ: "POWER",
  WURZEL: "SQRT",
  VERKETTEN: "CONCAT",
  TEXTKETTE: "CONCAT",
  LÄNGE: "LEN",
  GROSS: "UPPER",
  KLEIN: "LOWER",
  GLÄTTEN: "TRIM",
  LINKS: "LEFT",
  RECHTS: "RIGHT",
  TEIL: "MID",
  HEUTE: "TODAY",
  JETZT: "NOW",
  DATUM: "DATE",
  JAHR: "YEAR",
  MONAT: "MONTH",
  TAG: "DAY",
  ISTLEER: "ISBLANK",
  ISTZAHL: "ISNUMBER",
  ISTTEXT: "ISTEXT",
  ISTFEHLER: "ISERROR",
  SVERWEIS: "VLOOKUP",
  SUMMEWENNS: "SUMIFS",
  ZÄHLENWENNS: "COUNTIFS",
  MITTELWERTWENNS: "AVERAGEIFS",
  MAXWENNS: "MAXIFS",
  MINWENNS: "MINIFS",
  WENNNV: "IFNA",
  WENNS: "IFS",
  ERSTERWERT: "SWITCH",
  WAHL: "CHOOSE",
  XODER: "XOR",
  NV: "NA",
  VERGLEICH: "MATCH",
  XVERWEIS: "XLOOKUP",
  WVERWEIS: "HLOOKUP",
  ZEILE: "ROW",
  SPALTE: "COLUMN",
  ZEILEN: "ROWS",
  SPALTEN: "COLUMNS",
  KGRÖSSTE: "LARGE",
  KKLEINSTE: "SMALL",
  RANG: "RANK",
  "RANG.GLEICH": "RANK",
  MODALWERT: "MODE",
  "MODUS.EINF": "MODE",
  STABW: "STDEV",
  "STABW.S": "STDEV",
  "STABW.N": "STDEV.P",
  VARIANZ: "VAR",
  "VAR.S": "VAR",
  SUMMENPRODUKT: "SUMPRODUCT",
  QUADRATESUMME: "SUMSQ",
  OBERGRENZE: "CEILING",
  UNTERGRENZE: "FLOOR",
  VRUNDEN: "MROUND",
  KÜRZEN: "TRUNC",
  GERADE: "EVEN",
  UNGERADE: "ODD",
  VORZEICHEN: "SIGN",
  GGT: "GCD",
  KGV: "LCM",
  BOGENMASS: "RADIANS",
  GRAD: "DEGREES",
  ZUFALLSZAHL: "RAND",
  ZUFALLSBEREICH: "RANDBETWEEN",
  WECHSELN: "SUBSTITUTE",
  ERSETZEN: "REPLACE",
  FINDEN: "FIND",
  SUCHEN: "SEARCH",
  TEXTVERKETTEN: "TEXTJOIN",
  WERT: "VALUE",
  GROSS2: "PROPER",
  WIEDERHOLEN: "REPT",
  IDENTISCH: "EXACT",
  ZEICHEN: "CHAR",
  SÄUBERN: "CLEAN",
  WOCHENTAG: "WEEKDAY",
  KALENDERWOCHE: "WEEKNUM",
  ISOKALENDERWOCHE: "ISOWEEKNUM",
  TAGE: "DAYS",
  EDATUM: "EDATE",
  MONATSENDE: "EOMONTH",
  NETTOARBEITSTAGE: "NETWORKDAYS",
  ARBEITSTAG: "WORKDAY",
  STUNDE: "HOUR",
  SEKUNDE: "SECOND",
  ZEIT: "TIME",
  DATWERT: "DATEVALUE",
  ZEITWERT: "TIMEVALUE",
  ISTGERADE: "ISEVEN",
  ISTUNGERADE: "ISODD",
  ISTLOG: "ISLOGICAL",
  ISTKTEXT: "ISNONTEXT",
  ISTNV: "ISNA",
  ISTFEHL: "ISERR",
  FILTERN: "FILTER",
  SORTIEREN: "SORT",
  SORTIERENNACH: "SORTBY",
  EINDEUTIG: "UNIQUE",
  SEQUENZ: "SEQUENCE",
  MTRANS: "TRANSPOSE",
  ZUFALLSMATRIX: "RANDARRAY",
  XVERGLEICH: "XMATCH",
  TEXTTEILEN: "TEXTSPLIT",
  VSTAPELN: "VSTACK",
  HSTAPELN: "HSTACK",
  ÜBERNEHMEN: "TAKE",
  WEGLASSEN: "DROP",
  WAHLSPALTE: "CHOOSECOLS",
  WAHLZEILE: "CHOOSEROWS",
  ZUSPALTE: "TOCOL",
  ZUZEILE: "TOROW",
  ERWEITERN: "EXPAND",
  ZEILENUMBRUCH: "WRAPROWS",
  SPALTENUMBRUCH: "WRAPCOLS",
  HÄUFIGKEIT: "FREQUENCY",
  INDIREKT: "INDIRECT",
  "BEREICH.VERSCHIEBEN": "OFFSET",
  ISTBEZUG: "ISREF",
  ISTFORMEL: "ISFORMULA",
  FORMELTEXT: "FORMULATEXT",
  TEILERGEBNIS: "SUBTOTAL",
  RMZ: "PMT",
  ZW: "FV",
  BW: "PV",
  ZZR: "NPER",
  ZINS: "RATE",
  ZINSZ: "IPMT",
  KAPZ: "PPMT",
  NBW: "NPV",
  IKV: "IRR",
  "QUANTIL.INKL": "PERCENTILE.INC",
  "QUANTIL.EXKL": "PERCENTILE.EXC",
  "QUARTILE.INKL": "QUARTILE.INC",
  "RANG.MITTELW": "RANK.AVG",
  KORREL: "CORREL",
  BESTIMMTHEITSMASS: "RSQ",
  STEIGUNG: "SLOPE",
  ACHSENABSCHNITT: "INTERCEPT",
  "PROGNOSE.LINEAR": "FORECAST.LINEAR",
  "KOVARIANZ.P": "COVARIANCE.P",
  GEOMITTEL: "GEOMEAN",
  HARMITTEL: "HARMEAN",
  MITTELABW: "AVEDEV",
  MITTELWERTA: "AVERAGEA",
  "NORM.VERT": "NORM.DIST",
  FAKULTÄT: "FACT",
  KOMBINATIONEN: "COMBIN",
  VARIATIONEN: "PERMUT",
  "OBERGRENZE.MATHEMATIK": "CEILING.MATH",
  "UNTERGRENZE.MATHEMATIK": "FLOOR.MATH",
  ARCSIN: "ASIN",
  ARCCOS: "ACOS",
  ARCTAN: "ATAN",
  ARCTAN2: "ATAN2",
  RÖMISCH: "ROMAN",
  ARABISCH: "ARABIC",
  BASIS: "BASE",
  DEZIMAL: "DECIMAL",
  DEZINBIN: "DEC2BIN",
  BININDEZ: "BIN2DEC",
  DEZINHEX: "DEC2HEX",
  HEXINDEZ: "HEX2DEC",
  WAHR: "TRUE",
  FALSCH: "FALSE",
  FEST: "FIXED",
  UNIZEICHEN: "UNICHAR",
  ZAHLENWERT: "NUMBERVALUE",
  TEXTVOR: "TEXTBEFORE",
  TEXTNACH: "TEXTAFTER",
  BRTEILJAHRE: "YEARFRAC",
  TAGE360: "DAYS360",
  "NETTOARBEITSTAGE.INTL": "NETWORKDAYS.INTL",
  "ARBEITSTAG.INTL": "WORKDAY.INTL",
  TYP: "TYPE",
  ZUORDNEN: "MAP",
  REDUZIEREN: "REDUCE",
  NACHZEILE: "BYROW",
  NACHSPALTE: "BYCOL",
  MATRIXERSTELLEN: "MAKEARRAY",
  ISTAUSGELASSEN: "ISOMITTED",
  "FEHLER.TYP": "ERROR.TYPE",
  QUANTIL: "PERCENTILE.INC",
  PROGNOSE: "FORECAST.LINEAR",
};
const ENGLISH_ALIASES: Record<string, string> = {
  CONCATENATE: "CONCAT",
  "RANK.EQ": "RANK",
  "MODE.SNGL": "MODE",
  "STDEV.S": "STDEV",
  "VAR.S": "VAR",
  PERCENTILE: "PERCENTILE.INC",
  QUARTILE: "QUARTILE.INC",
  FORECAST: "FORECAST.LINEAR",
  COVAR: "COVARIANCE.P",
};
// Neuere Excel-Funktionen stehen in der Datei mit Vorsilbe „_xlfn.“ („_xlfn.XLOOKUP“).
const canonical = (name: string) => {
  const bare = name.replace(/^_XLFN\.(_XLWS\.)?/, "");
  return GERMAN[bare] ?? ENGLISH_ALIASES[bare] ?? bare;
};
const XLFN = new Set([
  "CONCAT",
  "TEXTJOIN",
  "IFS",
  "IFNA",
  "SWITCH",
  "XOR",
  "MAXIFS",
  "MINIFS",
  "XLOOKUP",
  "DAYS",
  "ISOWEEKNUM",
  "STDEV.P",
  "VAR.P",
  "SORTBY",
  "UNIQUE",
  "SEQUENCE",
  "RANDARRAY",
  "XMATCH",
  "TEXTSPLIT",
  "VSTACK",
  "HSTACK",
  "TAKE",
  "DROP",
  "CHOOSECOLS",
  "CHOOSEROWS",
  "TOCOL",
  "TOROW",
  "EXPAND",
  "WRAPROWS",
  "WRAPCOLS",
  "LET",
  "TEXTBEFORE",
  "TEXTAFTER",
  "PERCENTILE.INC",
  "PERCENTILE.EXC",
  "QUARTILE.INC",
  "RANK.AVG",
  "FORECAST.LINEAR",
  "COVARIANCE.P",
  "NORM.DIST",
  "CEILING.MATH",
  "FLOOR.MATH",
  "ARABIC",
  "BASE",
  "DECIMAL",
  "UNICHAR",
  "UNICODE",
  "NUMBERVALUE",
  "NETWORKDAYS.INTL",
  "WORKDAY.INTL",
  "ISFORMULA",
  "FORMULATEXT",
  "LAMBDA",
  "MAP",
  "REDUCE",
  "SCAN",
  "BYROW",
  "BYCOL",
  "MAKEARRAY",
  "ISOMITTED",
  "ANCHORARRAY",
]);
// Arbeitsblatt-Funktionen mit doppelter Vorsilbe („_xlfn._xlws.FILTER“).
const XLWS = new Set(["FILTER", "SORT"]);
// Nur die üblichen deutschen Namen zurückübersetzen (nicht die Nebenformen).
const GERMAN_OF = Object.fromEntries(
  Object.entries(GERMAN)
    .filter(
      ([german]) =>
        ![
          "TEXTKETTE",
          "RANG.GLEICH",
          "MODUS.EINF",
          "STABW.S",
          "VAR.S",
          "QUANTIL",
          "PROGNOSE",
          "ZUORDNEN",
          "REDUZIEREN",
        ].includes(german),
    )
    .map(([german, english]) => [english, german]),
);

// Beispiele für die Hilfe (vor allem für Funktionen mit LAMBDA, die ohne Beispiel schwer verständlich sind).
const EXAMPLES: Record<string, string> = {
  NACHZEILE: "=NACHZEILE(B2:D10;LAMBDA(zeile;SUMME(zeile))) – Summe je Zeile, z. B. Stunden je Person",
  NACHSPALTE: "=NACHSPALTE(B2:D10;LAMBDA(spalte;MAX(spalte))) – Höchstwert je Spalte",
  MAP: "=MAP(C2:C10;LAMBDA(stunden;stunden*45)) – jeden Wert umrechnen",
  REDUCE: "=REDUCE(0;C2:C10;LAMBDA(summe;wert;summe+wert)) – alles zusammenzählen",
  SCAN: "=SCAN(0;C2:C10;LAMBDA(summe;wert;summe+wert)) – laufende Summe",
  MATRIXERSTELLEN: "=MATRIXERSTELLEN(3;4;LAMBDA(z;s;z*s)) – Einmaleins 3 × 4",
  LAMBDA: "=LET(netto;LAMBDA(betrag;betrag/1.081);netto(108.1)) – eigene Funktion mit Namen",
  ISTAUSGELASSEN: "=LET(f;LAMBDA(a;b;WENN(ISTAUSGELASSEN(b);a;a+b));f(5)) – zweiter Wert ist freiwillig",
  LET: "=LET(stunden;C2;satz;45;stunden*satz) – Zwischenwerte benennen",
  FILTERN: '=FILTERN(A2:C10;B2:B10="Pflege") – nur Zeilen aus der Pflege',
  SORTIEREN: "=SORTIEREN(A2:C10;3;-1) – nach der 3. Spalte absteigend",
  EINDEUTIG: "=EINDEUTIG(B2:B10) – jede Abteilung einmal",
  XVERWEIS: '=XVERWEIS("Anna";A2:A10;C2:C10;"nicht gefunden")',
  SUMMEWENNS: '=SUMMEWENNS(C2:C10;B2:B10;"Pflege";C2:C10;">4")',
};

// Funktionen für die Hilfe in der Formelleiste (deutsche Namen, kurze Beschreibung).
export type FunctionHelp = { name: string; syntax: string; text: string; example?: string };
export const FUNCTION_HELP: FunctionHelp[] = [
  { name: "SUMME", syntax: "SUMME(Zahl1; Zahl2; …)", text: "Addiert Zahlen oder Bereiche" },
  { name: "MITTELWERT", syntax: "MITTELWERT(Zahl1; …)", text: "Durchschnitt" },
  { name: "MIN", syntax: "MIN(Zahl1; …)", text: "Kleinster Wert" },
  { name: "MAX", syntax: "MAX(Zahl1; …)", text: "Grösster Wert" },
  { name: "MEDIAN", syntax: "MEDIAN(Zahl1; …)", text: "Mittlerer Wert" },
  { name: "PRODUKT", syntax: "PRODUKT(Zahl1; …)", text: "Multipliziert Zahlen" },
  { name: "ANZAHL", syntax: "ANZAHL(Wert1; …)", text: "Zählt Zellen mit Zahlen" },
  { name: "ANZAHL2", syntax: "ANZAHL2(Wert1; …)", text: "Zählt nicht leere Zellen" },
  { name: "ANZAHLLEEREZELLEN", syntax: "ANZAHLLEEREZELLEN(Bereich)", text: "Zählt leere Zellen" },
  { name: "ZÄHLENWENN", syntax: "ZÄHLENWENN(Bereich; Kriterium)", text: "Zählt Zellen, die eine Bedingung erfüllen" },
  { name: "SUMMEWENN", syntax: "SUMMEWENN(Bereich; Kriterium; [Summenbereich])", text: "Summe mit Bedingung" },
  {
    name: "MITTELWERTWENN",
    syntax: "MITTELWERTWENN(Bereich; Kriterium; [Bereich])",
    text: "Durchschnitt mit Bedingung",
  },
  { name: "WENN", syntax: "WENN(Prüfung; Dann; [Sonst])", text: "Wert abhängig von einer Bedingung" },
  { name: "WENNFEHLER", syntax: "WENNFEHLER(Wert; Ersatz)", text: "Ersatzwert bei einem Fehler" },
  { name: "UND", syntax: "UND(Wahrheitswert1; …)", text: "WAHR, wenn alle zutreffen" },
  { name: "ODER", syntax: "ODER(Wahrheitswert1; …)", text: "WAHR, wenn eine zutrifft" },
  { name: "NICHT", syntax: "NICHT(Wahrheitswert)", text: "Kehrt um" },
  { name: "RUNDEN", syntax: "RUNDEN(Zahl; Stellen)", text: "Kaufmännisch runden" },
  { name: "AUFRUNDEN", syntax: "AUFRUNDEN(Zahl; Stellen)", text: "Aufrunden" },
  { name: "ABRUNDEN", syntax: "ABRUNDEN(Zahl; Stellen)", text: "Abrunden" },
  { name: "GANZZAHL", syntax: "GANZZAHL(Zahl)", text: "Auf ganze Zahl abrunden" },
  { name: "ABS", syntax: "ABS(Zahl)", text: "Betrag ohne Vorzeichen" },
  { name: "REST", syntax: "REST(Zahl; Divisor)", text: "Rest einer Division" },
  { name: "POTENZ", syntax: "POTENZ(Zahl; Potenz)", text: "Potenz" },
  { name: "WURZEL", syntax: "WURZEL(Zahl)", text: "Quadratwurzel" },
  { name: "VERKETTEN", syntax: "VERKETTEN(Text1; Text2; …)", text: "Verbindet Texte (auch mit &)" },
  { name: "LÄNGE", syntax: "LÄNGE(Text)", text: "Anzahl Zeichen" },
  { name: "LINKS", syntax: "LINKS(Text; [Anzahl])", text: "Erste Zeichen" },
  { name: "RECHTS", syntax: "RECHTS(Text; [Anzahl])", text: "Letzte Zeichen" },
  { name: "TEIL", syntax: "TEIL(Text; Start; Anzahl)", text: "Zeichen aus der Mitte" },
  { name: "GROSS", syntax: "GROSS(Text)", text: "In Grossbuchstaben" },
  { name: "KLEIN", syntax: "KLEIN(Text)", text: "In Kleinbuchstaben" },
  { name: "GLÄTTEN", syntax: "GLÄTTEN(Text)", text: "Überzählige Leerzeichen entfernen" },
  { name: "HEUTE", syntax: "HEUTE()", text: "Heutiges Datum" },
  { name: "JETZT", syntax: "JETZT()", text: "Datum und Uhrzeit" },
  { name: "DATUM", syntax: "DATUM(Jahr; Monat; Tag)", text: "Datum aus Teilen" },
  { name: "JAHR", syntax: "JAHR(Datum)", text: "Jahr eines Datums" },
  { name: "MONAT", syntax: "MONAT(Datum)", text: "Monat eines Datums" },
  { name: "TAG", syntax: "TAG(Datum)", text: "Tag eines Datums" },
  {
    name: "SVERWEIS",
    syntax: "SVERWEIS(Suchwert; Bereich; Spalte; [Bereich_Verweis])",
    text: "Wert in einer Tabelle nachschlagen",
  },
  { name: "ISTLEER", syntax: "ISTLEER(Wert)", text: "WAHR bei leerer Zelle" },
  { name: "ISTZAHL", syntax: "ISTZAHL(Wert)", text: "WAHR bei einer Zahl" },
  { name: "ISTTEXT", syntax: "ISTTEXT(Wert)", text: "WAHR bei Text" },
  { name: "ISTFEHLER", syntax: "ISTFEHLER(Wert)", text: "WAHR bei einem Fehlerwert" },
  {
    name: "SUMMEWENNS",
    syntax: "SUMMEWENNS(Summenbereich; Bereich1; Kriterium1; …)",
    text: "Summe mit mehreren Bedingungen",
  },
  { name: "ZÄHLENWENNS", syntax: "ZÄHLENWENNS(Bereich1; Kriterium1; …)", text: "Zählt mit mehreren Bedingungen" },
  {
    name: "MITTELWERTWENNS",
    syntax: "MITTELWERTWENNS(Mittelwertbereich; Bereich1; Kriterium1; …)",
    text: "Durchschnitt mit mehreren Bedingungen",
  },
  { name: "MAXWENNS", syntax: "MAXWENNS(Maxbereich; Bereich1; Kriterium1; …)", text: "Grösster Wert mit Bedingungen" },
  { name: "MINWENNS", syntax: "MINWENNS(Minbereich; Bereich1; Kriterium1; …)", text: "Kleinster Wert mit Bedingungen" },
  { name: "WENNS", syntax: "WENNS(Prüfung1; Wert1; Prüfung2; Wert2; …)", text: "Erste zutreffende Bedingung" },
  { name: "WENNNV", syntax: "WENNNV(Wert; Ersatz)", text: "Ersatzwert, wenn nichts gefunden wurde" },
  {
    name: "ERSTERWERT",
    syntax: "ERSTERWERT(Ausdruck; Wert1; Ergebnis1; …; [Sonst])",
    text: "Ergebnis zum passenden Wert",
  },
  { name: "WAHL", syntax: "WAHL(Index; Wert1; Wert2; …)", text: "Wählt einen Wert aus der Liste" },
  { name: "XODER", syntax: "XODER(Wahrheitswert1; …)", text: "WAHR bei ungerader Anzahl zutreffender Werte" },
  { name: "NV", syntax: "NV()", text: "Fehlerwert „nicht vorhanden“" },
  { name: "VERGLEICH", syntax: "VERGLEICH(Suchwert; Bereich; [Vergleichstyp])", text: "Position eines Wertes" },
  { name: "INDEX", syntax: "INDEX(Bereich; Zeile; [Spalte])", text: "Wert an einer Position" },
  {
    name: "XVERWEIS",
    syntax: "XVERWEIS(Suchwert; Suchbereich; Ergebnisbereich; [Wenn_nicht_gefunden]; [Vergleichsmodus]; [Suchmodus])",
    text: "Wert nachschlagen (flexibel)",
  },
  {
    name: "WVERWEIS",
    syntax: "WVERWEIS(Suchwert; Bereich; Zeile; [Bereich_Verweis])",
    text: "Wert in einer Tabelle waagrecht nachschlagen",
  },
  { name: "ZEILE", syntax: "ZEILE([Bezug])", text: "Zeilennummer" },
  { name: "SPALTE", syntax: "SPALTE([Bezug])", text: "Spaltennummer" },
  { name: "ZEILEN", syntax: "ZEILEN(Bereich)", text: "Anzahl Zeilen eines Bereichs" },
  { name: "SPALTEN", syntax: "SPALTEN(Bereich)", text: "Anzahl Spalten eines Bereichs" },
  { name: "KGRÖSSTE", syntax: "KGRÖSSTE(Bereich; k)", text: "k-grösster Wert" },
  { name: "KKLEINSTE", syntax: "KKLEINSTE(Bereich; k)", text: "k-kleinster Wert" },
  { name: "RANG", syntax: "RANG(Zahl; Bezug; [Reihenfolge])", text: "Rang einer Zahl in einer Liste" },
  { name: "MODALWERT", syntax: "MODALWERT(Zahl1; …)", text: "Häufigster Wert" },
  { name: "STABW", syntax: "STABW(Zahl1; …)", text: "Standardabweichung (Stichprobe)" },
  { name: "STABW.N", syntax: "STABW.N(Zahl1; …)", text: "Standardabweichung (Grundgesamtheit)" },
  { name: "VARIANZ", syntax: "VARIANZ(Zahl1; …)", text: "Varianz (Stichprobe)" },
  { name: "VAR.P", syntax: "VAR.P(Zahl1; …)", text: "Varianz (Grundgesamtheit)" },
  { name: "SUMMENPRODUKT", syntax: "SUMMENPRODUKT(Bereich1; Bereich2; …)", text: "Summe der Produkte" },
  { name: "QUADRATESUMME", syntax: "QUADRATESUMME(Zahl1; …)", text: "Summe der Quadrate" },
  { name: "OBERGRENZE", syntax: "OBERGRENZE(Zahl; [Schritt])", text: "Auf ein Vielfaches aufrunden" },
  { name: "UNTERGRENZE", syntax: "UNTERGRENZE(Zahl; [Schritt])", text: "Auf ein Vielfaches abrunden" },
  { name: "VRUNDEN", syntax: "VRUNDEN(Zahl; Vielfaches)", text: "Auf ein Vielfaches runden" },
  { name: "KÜRZEN", syntax: "KÜRZEN(Zahl; [Stellen])", text: "Nachkommastellen abschneiden" },
  { name: "GERADE", syntax: "GERADE(Zahl)", text: "Auf gerade Zahl aufrunden" },
  { name: "UNGERADE", syntax: "UNGERADE(Zahl)", text: "Auf ungerade Zahl aufrunden" },
  { name: "VORZEICHEN", syntax: "VORZEICHEN(Zahl)", text: "1, 0 oder -1" },
  { name: "QUOTIENT", syntax: "QUOTIENT(Zahl; Divisor)", text: "Ganzzahliger Anteil einer Division" },
  { name: "GGT", syntax: "GGT(Zahl1; …)", text: "Grösster gemeinsamer Teiler" },
  { name: "KGV", syntax: "KGV(Zahl1; …)", text: "Kleinstes gemeinsames Vielfaches" },
  { name: "PI", syntax: "PI()", text: "Kreiszahl" },
  { name: "EXP", syntax: "EXP(Zahl)", text: "e hoch Zahl" },
  { name: "LN", syntax: "LN(Zahl)", text: "Natürlicher Logarithmus" },
  { name: "LOG", syntax: "LOG(Zahl; [Basis])", text: "Logarithmus" },
  { name: "LOG10", syntax: "LOG10(Zahl)", text: "Logarithmus zur Basis 10" },
  { name: "SIN", syntax: "SIN(Zahl)", text: "Sinus (Bogenmass)" },
  { name: "COS", syntax: "COS(Zahl)", text: "Kosinus (Bogenmass)" },
  { name: "TAN", syntax: "TAN(Zahl)", text: "Tangens (Bogenmass)" },
  { name: "BOGENMASS", syntax: "BOGENMASS(Winkel)", text: "Grad in Bogenmass" },
  { name: "GRAD", syntax: "GRAD(Winkel)", text: "Bogenmass in Grad" },
  { name: "ZUFALLSZAHL", syntax: "ZUFALLSZAHL()", text: "Zufallszahl zwischen 0 und 1" },
  { name: "ZUFALLSBEREICH", syntax: "ZUFALLSBEREICH(Untere; Obere)", text: "Ganze Zufallszahl im Bereich" },
  { name: "WECHSELN", syntax: "WECHSELN(Text; Alt; Neu; [Vorkommen])", text: "Text ersetzen" },
  { name: "ERSETZEN", syntax: "ERSETZEN(Text; Start; Anzahl; Neu)", text: "Zeichen an einer Stelle ersetzen" },
  { name: "FINDEN", syntax: "FINDEN(Suchtext; Text; [Start])", text: "Position (Gross-/Kleinschreibung beachten)" },
  { name: "SUCHEN", syntax: "SUCHEN(Suchtext; Text; [Start])", text: "Position (auch mit * und ?)" },
  {
    name: "TEXTVERKETTEN",
    syntax: "TEXTVERKETTEN(Trennzeichen; Leere_ignorieren; Text1; …)",
    text: "Texte mit Trennzeichen verbinden",
  },
  { name: "TEXT", syntax: "TEXT(Wert; Format)", text: "Zahl oder Datum als Text, z. B. „TT.MM.JJJJ“" },
  { name: "WERT", syntax: "WERT(Text)", text: "Text in eine Zahl umwandeln" },
  { name: "GROSS2", syntax: "GROSS2(Text)", text: "Wortanfänge gross" },
  { name: "WIEDERHOLEN", syntax: "WIEDERHOLEN(Text; Anzahl)", text: "Text wiederholen" },
  { name: "IDENTISCH", syntax: "IDENTISCH(Text1; Text2)", text: "Texte genau gleich?" },
  { name: "ZEICHEN", syntax: "ZEICHEN(Zahl)", text: "Zeichen zu einem Code" },
  { name: "CODE", syntax: "CODE(Text)", text: "Code des ersten Zeichens" },
  { name: "SÄUBERN", syntax: "SÄUBERN(Text)", text: "Steuerzeichen entfernen" },
  { name: "WOCHENTAG", syntax: "WOCHENTAG(Datum; [Typ])", text: "Wochentag als Zahl (Typ 2: Montag = 1)" },
  { name: "KALENDERWOCHE", syntax: "KALENDERWOCHE(Datum; [Typ])", text: "Kalenderwoche (Typ 21: nach ISO)" },
  { name: "ISOKALENDERWOCHE", syntax: "ISOKALENDERWOCHE(Datum)", text: "Kalenderwoche nach ISO" },
  { name: "TAGE", syntax: "TAGE(Enddatum; Startdatum)", text: "Tage zwischen zwei Daten" },
  { name: "EDATUM", syntax: "EDATUM(Datum; Monate)", text: "Datum Monate später oder früher" },
  { name: "MONATSENDE", syntax: "MONATSENDE(Datum; Monate)", text: "Letzter Tag des Monats" },
  {
    name: "NETTOARBEITSTAGE",
    syntax: "NETTOARBEITSTAGE(Start; Ende; [Freie_Tage])",
    text: "Arbeitstage (Mo–Fr) zwischen zwei Daten",
  },
  { name: "ARBEITSTAG", syntax: "ARBEITSTAG(Start; Tage; [Freie_Tage])", text: "Datum nach Arbeitstagen" },
  { name: "STUNDE", syntax: "STUNDE(Zeit)", text: "Stunde einer Uhrzeit" },
  { name: "MINUTE", syntax: "MINUTE(Zeit)", text: "Minute einer Uhrzeit" },
  { name: "SEKUNDE", syntax: "SEKUNDE(Zeit)", text: "Sekunde einer Uhrzeit" },
  { name: "ZEIT", syntax: "ZEIT(Stunde; Minute; Sekunde)", text: "Uhrzeit aus Teilen" },
  { name: "DATWERT", syntax: "DATWERT(Text)", text: "Text in ein Datum umwandeln" },
  { name: "ZEITWERT", syntax: "ZEITWERT(Text)", text: "Text in eine Uhrzeit umwandeln" },
  { name: "DATEDIF", syntax: "DATEDIF(Start; Ende; Einheit)", text: "Abstand in „Y“, „M“, „D“, „YM“, „MD“, „YD“" },
  { name: "ISTGERADE", syntax: "ISTGERADE(Zahl)", text: "WAHR bei gerader Zahl" },
  { name: "ISTUNGERADE", syntax: "ISTUNGERADE(Zahl)", text: "WAHR bei ungerader Zahl" },
  { name: "ISTLOG", syntax: "ISTLOG(Wert)", text: "WAHR bei einem Wahrheitswert" },
  { name: "ISTKTEXT", syntax: "ISTKTEXT(Wert)", text: "WAHR, wenn kein Text" },
  { name: "ISTNV", syntax: "ISTNV(Wert)", text: "WAHR beim Fehler „nicht vorhanden“" },
  { name: "ISTFEHL", syntax: "ISTFEHL(Wert)", text: "WAHR bei Fehlern ausser „nicht vorhanden“" },
  {
    name: "FILTERN",
    syntax: "FILTERN(Bereich; Einschliessen; [Wenn_leer])",
    text: "Zeilen, die eine Bedingung erfüllen (läuft über)",
  },
  {
    name: "SORTIEREN",
    syntax: "SORTIEREN(Bereich; [Spalte]; [Reihenfolge]; [Nach_Spalte])",
    text: "Bereich sortiert (läuft über)",
  },
  {
    name: "SORTIERENNACH",
    syntax: "SORTIERENNACH(Bereich; Nach_Bereich1; [Reihenfolge1]; …)",
    text: "Nach anderen Spalten sortiert",
  },
  { name: "EINDEUTIG", syntax: "EINDEUTIG(Bereich; [Nach_Spalte]; [Genau_einmal])", text: "Werte ohne Doppelte" },
  { name: "SEQUENZ", syntax: "SEQUENZ(Zeilen; [Spalten]; [Anfang]; [Schritt])", text: "Zahlenfolge" },
  { name: "MTRANS", syntax: "MTRANS(Bereich)", text: "Zeilen und Spalten tauschen" },
  {
    name: "ZUFALLSMATRIX",
    syntax: "ZUFALLSMATRIX([Zeilen]; [Spalten]; [Min]; [Max]; [Ganzzahl])",
    text: "Bereich mit Zufallszahlen",
  },
  {
    name: "XVERGLEICH",
    syntax: "XVERGLEICH(Suchwert; Suchbereich; [Vergleichsmodus]; [Suchmodus])",
    text: "Position eines Wertes (flexibel)",
  },
  {
    name: "TEXTTEILEN",
    syntax: "TEXTTEILEN(Text; Spaltentrennzeichen; [Zeilentrennzeichen]; [Leere_ignorieren])",
    text: "Text in Zellen aufteilen",
  },
  { name: "VSTAPELN", syntax: "VSTAPELN(Bereich1; Bereich2; …)", text: "Bereiche untereinander" },
  { name: "HSTAPELN", syntax: "HSTAPELN(Bereich1; Bereich2; …)", text: "Bereiche nebeneinander" },
  { name: "ÜBERNEHMEN", syntax: "ÜBERNEHMEN(Bereich; Zeilen; [Spalten])", text: "Erste oder letzte Zeilen/Spalten" },
  {
    name: "WEGLASSEN",
    syntax: "WEGLASSEN(Bereich; Zeilen; [Spalten])",
    text: "Ohne die ersten oder letzten Zeilen/Spalten",
  },
  { name: "WAHLSPALTE", syntax: "WAHLSPALTE(Bereich; Spalte1; …)", text: "Ausgewählte Spalten" },
  { name: "WAHLZEILE", syntax: "WAHLZEILE(Bereich; Zeile1; …)", text: "Ausgewählte Zeilen" },
  { name: "ZUSPALTE", syntax: "ZUSPALTE(Bereich; [Ignorieren]; [Nach_Spalte])", text: "Bereich als eine Spalte" },
  { name: "ZUZEILE", syntax: "ZUZEILE(Bereich; [Ignorieren]; [Nach_Spalte])", text: "Bereich als eine Zeile" },
  { name: "ERWEITERN", syntax: "ERWEITERN(Bereich; Zeilen; [Spalten]; [Auffüllen_mit])", text: "Bereich vergrössern" },
  { name: "ZEILENUMBRUCH", syntax: "ZEILENUMBRUCH(Liste; Anzahl; [Auffüllen_mit])", text: "Liste in Zeilen umbrechen" },
  {
    name: "SPALTENUMBRUCH",
    syntax: "SPALTENUMBRUCH(Liste; Anzahl; [Auffüllen_mit])",
    text: "Liste in Spalten umbrechen",
  },
  { name: "MMULT", syntax: "MMULT(Matrix1; Matrix2)", text: "Matrizen multiplizieren" },
  { name: "HÄUFIGKEIT", syntax: "HÄUFIGKEIT(Daten; Klassen)", text: "Anzahl je Klasse" },
  { name: "LET", syntax: "LET(Name1; Wert1; …; Berechnung)", text: "Zwischenergebnisse benennen" },
  { name: "INDIREKT", syntax: "INDIREKT(Bezug_als_Text; [A1])", text: 'Bezug aus einem Text, z. B. "B"&A1' },
  {
    name: "BEREICH.VERSCHIEBEN",
    syntax: "BEREICH.VERSCHIEBEN(Bezug; Zeilen; Spalten; [Höhe]; [Breite])",
    text: "Verschobener Bereich",
  },
  { name: "ISTBEZUG", syntax: "ISTBEZUG(Wert)", text: "WAHR bei einem Zellbezug" },
  { name: "ISTFORMEL", syntax: "ISTFORMEL(Bezug)", text: "WAHR, wenn die Zelle eine Formel enthält" },
  { name: "FORMELTEXT", syntax: "FORMELTEXT(Bezug)", text: "Formel einer Zelle als Text" },
  {
    name: "TEILERGEBNIS",
    syntax: "TEILERGEBNIS(Funktion; Bereich1; …)",
    text: "Summe & Co. ohne gefilterte Zeilen (9 = Summe, 109 = auch ohne ausgeblendete)",
  },
  { name: "RMZ", syntax: "RMZ(Zins; Perioden; Barwert; [Endwert]; [Fällig])", text: "Regelmässige Zahlung (Rate)" },
  { name: "ZW", syntax: "ZW(Zins; Perioden; Zahlung; [Barwert]; [Fällig])", text: "Endwert einer Anlage" },
  { name: "BW", syntax: "BW(Zins; Perioden; Zahlung; [Endwert]; [Fällig])", text: "Barwert" },
  { name: "ZZR", syntax: "ZZR(Zins; Zahlung; Barwert; [Endwert]; [Fällig])", text: "Anzahl Zahlungsperioden" },
  {
    name: "ZINS",
    syntax: "ZINS(Perioden; Zahlung; Barwert; [Endwert]; [Fällig]; [Schätzwert])",
    text: "Zinssatz je Periode",
  },
  {
    name: "ZINSZ",
    syntax: "ZINSZ(Zins; Periode; Perioden; Barwert; [Endwert]; [Fällig])",
    text: "Zinsanteil einer Rate",
  },
  {
    name: "KAPZ",
    syntax: "KAPZ(Zins; Periode; Perioden; Barwert; [Endwert]; [Fällig])",
    text: "Tilgungsanteil einer Rate",
  },
  { name: "NBW", syntax: "NBW(Zins; Wert1; …)", text: "Nettobarwert" },
  { name: "IKV", syntax: "IKV(Werte; [Schätzwert])", text: "Interner Zinsfuss" },
  { name: "QUANTIL.INKL", syntax: "QUANTIL.INKL(Bereich; k)", text: "Quantil (k zwischen 0 und 1)" },
  { name: "QUANTIL.EXKL", syntax: "QUANTIL.EXKL(Bereich; k)", text: "Quantil ohne Randwerte" },
  { name: "QUARTILE.INKL", syntax: "QUARTILE.INKL(Bereich; Quartil)", text: "Quartil (0 bis 4)" },
  { name: "RANG.MITTELW", syntax: "RANG.MITTELW(Zahl; Bezug; [Reihenfolge])", text: "Rang, bei Gleichstand gemittelt" },
  { name: "KORREL", syntax: "KORREL(Bereich1; Bereich2)", text: "Korrelation" },
  { name: "BESTIMMTHEITSMASS", syntax: "BESTIMMTHEITSMASS(Y_Werte; X_Werte)", text: "Bestimmtheitsmass (R²)" },
  { name: "STEIGUNG", syntax: "STEIGUNG(Y_Werte; X_Werte)", text: "Steigung der Trendgeraden" },
  { name: "ACHSENABSCHNITT", syntax: "ACHSENABSCHNITT(Y_Werte; X_Werte)", text: "Achsenabschnitt der Trendgeraden" },
  { name: "PROGNOSE.LINEAR", syntax: "PROGNOSE.LINEAR(X; Y_Werte; X_Werte)", text: "Wert auf der Trendgeraden" },
  { name: "KOVARIANZ.P", syntax: "KOVARIANZ.P(Bereich1; Bereich2)", text: "Kovarianz" },
  { name: "GEOMITTEL", syntax: "GEOMITTEL(Zahl1; …)", text: "Geometrisches Mittel" },
  { name: "HARMITTEL", syntax: "HARMITTEL(Zahl1; …)", text: "Harmonisches Mittel" },
  { name: "MITTELABW", syntax: "MITTELABW(Zahl1; …)", text: "Mittlere Abweichung" },
  { name: "MITTELWERTA", syntax: "MITTELWERTA(Wert1; …)", text: "Durchschnitt (Text zählt als 0)" },
  { name: "MAXA", syntax: "MAXA(Wert1; …)", text: "Grösster Wert (Wahrheitswerte zählen)" },
  { name: "MINA", syntax: "MINA(Wert1; …)", text: "Kleinster Wert (Wahrheitswerte zählen)" },
  { name: "NORM.VERT", syntax: "NORM.VERT(x; Mittelwert; Standardabweichung; Kumuliert)", text: "Normalverteilung" },
  { name: "FAKULTÄT", syntax: "FAKULTÄT(Zahl)", text: "Fakultät" },
  { name: "KOMBINATIONEN", syntax: "KOMBINATIONEN(n; k)", text: "Anzahl Kombinationen" },
  { name: "VARIATIONEN", syntax: "VARIATIONEN(n; k)", text: "Anzahl Variationen" },
  {
    name: "OBERGRENZE.MATHEMATIK",
    syntax: "OBERGRENZE.MATHEMATIK(Zahl; [Schritt]; [Modus])",
    text: "Aufrunden auf ein Vielfaches",
  },
  {
    name: "UNTERGRENZE.MATHEMATIK",
    syntax: "UNTERGRENZE.MATHEMATIK(Zahl; [Schritt]; [Modus])",
    text: "Abrunden auf ein Vielfaches",
  },
  { name: "ARCSIN", syntax: "ARCSIN(Zahl)", text: "Arkussinus" },
  { name: "ARCCOS", syntax: "ARCCOS(Zahl)", text: "Arkuskosinus" },
  { name: "ARCTAN", syntax: "ARCTAN(Zahl)", text: "Arkustangens" },
  { name: "ARCTAN2", syntax: "ARCTAN2(x; y)", text: "Winkel aus Koordinaten" },
  { name: "RÖMISCH", syntax: "RÖMISCH(Zahl)", text: "Römische Zahl" },
  { name: "ARABISCH", syntax: "ARABISCH(Text)", text: "Römische Zahl in Zahl" },
  { name: "BASIS", syntax: "BASIS(Zahl; Basis; [Länge])", text: "Zahl in anderem Zahlensystem" },
  { name: "DEZIMAL", syntax: "DEZIMAL(Text; Basis)", text: "Zahl aus anderem Zahlensystem" },
  { name: "DEZINBIN", syntax: "DEZINBIN(Zahl; [Stellen])", text: "Dezimal in binär" },
  { name: "BININDEZ", syntax: "BININDEZ(Zahl)", text: "Binär in dezimal" },
  { name: "DEZINHEX", syntax: "DEZINHEX(Zahl; [Stellen])", text: "Dezimal in hexadezimal" },
  { name: "HEXINDEZ", syntax: "HEXINDEZ(Zahl)", text: "Hexadezimal in dezimal" },
  { name: "WAHR", syntax: "WAHR()", text: "Wahrheitswert WAHR" },
  { name: "FALSCH", syntax: "FALSCH()", text: "Wahrheitswert FALSCH" },
  {
    name: "FEST",
    syntax: "FEST(Zahl; [Dezimalstellen]; [Ohne_Trennzeichen])",
    text: "Zahl als Text mit festen Dezimalstellen",
  },
  { name: "UNIZEICHEN", syntax: "UNIZEICHEN(Zahl)", text: "Zeichen zu einem Unicode-Wert" },
  { name: "UNICODE", syntax: "UNICODE(Text)", text: "Unicode-Wert des ersten Zeichens" },
  { name: "T", syntax: "T(Wert)", text: "Text oder leer" },
  { name: "N", syntax: "N(Wert)", text: "Wert als Zahl" },
  {
    name: "ZAHLENWERT",
    syntax: "ZAHLENWERT(Text; [Dezimalzeichen]; [Gruppentrennzeichen])",
    text: "Text in Zahl (mit Trennzeichen)",
  },
  { name: "TEXTVOR", syntax: "TEXTVOR(Text; Trennzeichen; [Vorkommen])", text: "Text vor einem Trennzeichen" },
  { name: "TEXTNACH", syntax: "TEXTNACH(Text; Trennzeichen; [Vorkommen])", text: "Text nach einem Trennzeichen" },
  { name: "BRTEILJAHRE", syntax: "BRTEILJAHRE(Start; Ende; [Basis])", text: "Anteil eines Jahres" },
  { name: "TAGE360", syntax: "TAGE360(Start; Ende; [Methode])", text: "Tage auf Basis von 360 Tagen" },
  {
    name: "NETTOARBEITSTAGE.INTL",
    syntax: "NETTOARBEITSTAGE.INTL(Start; Ende; [Wochenende]; [Freie_Tage])",
    text: "Arbeitstage mit eigenem Wochenende",
  },
  {
    name: "ARBEITSTAG.INTL",
    syntax: "ARBEITSTAG.INTL(Start; Tage; [Wochenende]; [Freie_Tage])",
    text: "Datum nach Arbeitstagen, eigenes Wochenende",
  },
  { name: "TYP", syntax: "TYP(Wert)", text: "Art des Wertes (1 Zahl, 2 Text, 4 Wahrheitswert, 16 Fehler)" },
  { name: "FEHLER.TYP", syntax: "FEHLER.TYP(Fehlerwert)", text: "Nummer eines Fehlers" },
  {
    name: "LAMBDA",
    syntax: "LAMBDA(Parameter1; …; Berechnung)",
    text: "Eigene Funktion, z. B. LAMBDA(x;x*2)(5) oder in LET benannt",
  },
  {
    name: "MAP",
    syntax: "MAP(Bereich1; …; LAMBDA(Wert1; …; Berechnung))",
    text: "Jeden Wert mit einem LAMBDA umrechnen",
  },
  {
    name: "REDUCE",
    syntax: "REDUCE([Anfangswert]; Bereich; LAMBDA(Summe; Wert; Berechnung))",
    text: "Alle Werte zu einem Ergebnis zusammenfassen",
  },
  {
    name: "SCAN",
    syntax: "SCAN([Anfangswert]; Bereich; LAMBDA(Summe; Wert; Berechnung))",
    text: "Wie REDUCE, mit allen Zwischenergebnissen",
  },
  { name: "NACHZEILE", syntax: "NACHZEILE(Bereich; LAMBDA(Zeile; Berechnung))", text: "Ein Ergebnis je Zeile" },
  { name: "NACHSPALTE", syntax: "NACHSPALTE(Bereich; LAMBDA(Spalte; Berechnung))", text: "Ein Ergebnis je Spalte" },
  {
    name: "MATRIXERSTELLEN",
    syntax: "MATRIXERSTELLEN(Zeilen; Spalten; LAMBDA(Zeile; Spalte; Berechnung))",
    text: "Bereich aus einer Berechnung je Zelle",
  },
  { name: "ISTAUSGELASSEN", syntax: "ISTAUSGELASSEN(Parameter)", text: "WAHR, wenn ein LAMBDA-Parameter fehlt" },
];
for (const item of FUNCTION_HELP) if (EXAMPLES[item.name]) item.example = EXAMPLES[item.name];

// Hilfe zu einer Funktion – unter dem deutschen oder dem englischen Namen (BYROW → NACHZEILE).
export function functionHelp(name: string): FunctionHelp | null {
  const english = canonical(name.toUpperCase());
  const german = GERMAN_OF[english] ?? english;
  return FUNCTION_HELP.find((item) => item.name === german) ?? null;
}
// Vorschläge beim Tippen: deutsche Namen zuerst, dann Treffer über den englischen Namen.
export function suggestFunctions(prefix: string, limit = 8): (FunctionHelp & { english?: string })[] {
  const typed = prefix.toUpperCase();
  const german = FUNCTION_HELP.filter((item) => item.name.startsWith(typed));
  const byEnglish = FUNCTION_HELP.filter((item) => {
    const english = canonical(item.name);
    return english !== item.name && english.startsWith(typed) && !german.includes(item);
  }).map((item) => ({ ...item, english: canonical(item.name) }));
  return [...german, ...byEnglish].slice(0, limit);
}

// LAMBDA mit den Variablen, die beim Erstellen sichtbar waren.
type Lambda = { kind: "lambda"; params: string[]; body: Expr; scope: Scope };
// Nicht übergebener LAMBDA-Parameter (ISTAUSGELASSEN).
type Omitted = { kind: "omitted" };
type Binding = Arg | Lambda | Omitted;
type Scope = Map<string, Binding> | undefined;
const isBound = (value: Binding | undefined): value is Lambda | Omitted =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "kind" in value;

export function evaluate(expr: Expr, resolver: Resolver, scope?: Scope): Value {
  const result = evaluateArg(expr, resolver, scope);
  return isGrid(result) ? (result.length === 1 && result[0].length === 1 ? result[0][0] : fail("#VALUE!")) : result;
}

// Ergebnis einer Zellformel: einzelner Wert oder ganzer Bereich (der dann in die Nachbarzellen „überläuft“).
export function evaluateCell(expr: Expr, resolver: Resolver): Value | Value[][] {
  const result = evaluateArg(expr, resolver, undefined);
  if (!isGrid(result)) return result;
  if (!result.length || !result[0]?.length) return fail("#CALC!");
  return result.length === 1 && result[0].length === 1 ? result[0][0] : result;
}

const COMPARISONS = new Set(["=", "<>", "<", ">", "<=", ">="]);
function binaryValue(op: string, left: Value, right: Value): Value {
  if (isError(left)) return left;
  if (isError(right)) return right;
  if (op === "&") return toText(left) + toText(right);
  if (COMPARISONS.has(op)) {
    const result = compare(left, right);
    if (op === "=") return result === 0;
    if (op === "<>") return result !== 0;
    if (op === "<") return result < 0;
    if (op === ">") return result > 0;
    if (op === "<=") return result <= 0;
    return result >= 0;
  }
  const a = toNumber(left);
  const b = toNumber(right);
  if (isError(a)) return a;
  if (isError(b)) return b;
  if (op === "+") return a + b;
  if (op === "-") return a - b;
  if (op === "*") return a * b;
  if (op === "/") return b === 0 ? fail("#DIV/0!") : a / b;
  const power = a ** b;
  return Number.isFinite(power) ? power : fail("#NUM!");
}

// Bezug als Text („B3“, „Tabelle2!A1:C4“, „'Mein Blatt'!D2“) für INDIREKT.
function referenceFromText(text: string): { sheet?: string; area: Area } | null {
  const trimmed = text.trim();
  const match = /^(?:'((?:[^']|'')+)'!|([^!'"]+)!)?(\$?[A-Za-z]{1,3}\$?\d{1,6}(?::\$?[A-Za-z]{1,3}\$?\d{1,6})?)$/.exec(
    trimmed,
  );
  if (match) {
    const area = parseArea(match[3].replace(/\$/g, ""));
    if (!area) return null;
    const sheet = match[1] !== undefined ? match[1].replace(/''/g, "'") : match[2];
    return { sheet, area };
  }
  // Ganze Spalten („A:C“).
  const columns = /^(?:'((?:[^']|'')+)'!|([^!'"]+)!)?\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})$/.exec(trimmed);
  if (!columns) return null;
  const [a, b] = [columnIndex(columns[3]), columnIndex(columns[4])];
  return {
    sheet: columns[1] !== undefined ? columns[1].replace(/''/g, "'") : columns[2],
    area: { c1: Math.min(a, b), r1: 0, c2: Math.max(a, b), r2: MAX_ROWS - 1 },
  };
}

// Ein Name ohne LET-/LAMBDA-Bindung ist ein benannter Bereich der Arbeitsmappe.
function namedReference(expr: Expr, resolver: Resolver, scope: Scope) {
  if (expr.k !== "name" || scope?.has(expr.v)) return null;
  return resolver.name?.(expr.v) ?? null;
}
const namedExpr = (reference: { sheet?: string; area: Area }): Expr =>
  reference.area.c1 === reference.area.c2 && reference.area.r1 === reference.area.r2
    ? { k: "ref", sheet: reference.sheet, col: reference.area.c1, row: reference.area.r1 }
    : { k: "range", sheet: reference.sheet, area: reference.area };

// Bezug eines Ausdrucks (Zelle, Bereich, INDIREKT, BEREICH.VERSCHIEBEN) – für Funktionen, die mit der Lage arbeiten.
function referenceOf(expr: Expr, resolver: Resolver, scope: Scope): { sheet?: string; area: Area } | CellError | null {
  const named = namedReference(expr, resolver, scope);
  if (named) return named;
  if (expr.k === "ref") return { sheet: expr.sheet, area: { c1: expr.col, r1: expr.row, c2: expr.col, r2: expr.row } };
  if (expr.k === "range") return { sheet: expr.sheet, area: expr.area };
  if (expr.k === "spillref") {
    if (expr.sheet !== undefined && !resolver.hasSheet(expr.sheet)) return fail("#REF!");
    const area = resolver.spill?.(expr.sheet, expr.col, expr.row);
    // Zelle ohne Überlauf: nur die Zelle selbst (Excel: einzelner Wert).
    return { sheet: expr.sheet, area: area ?? { c1: expr.col, r1: expr.row, c2: expr.col, r2: expr.row } };
  }
  if (expr.k !== "call") return null;
  const name = canonical(expr.name);
  if (name === "INDIRECT") {
    if (expr.args.length < 1 || expr.args.length > 2) return fail("#VALUE!");
    const text = evaluate(expr.args[0], resolver, scope);
    if (isError(text)) return text;
    if (expr.args[1] !== undefined) {
      const a1 = truthy(evaluate(expr.args[1], resolver, scope));
      if (isError(a1)) return a1;
      // Z1S1-Schreibweise („Z2S3“).
      if (!a1) {
        const rc = /^[ZR](\d+)[SC](\d+)$/i.exec(toText(text).trim());
        if (!rc) return fail("#REF!");
        const row = Number(rc[1]) - 1;
        const col = Number(rc[2]) - 1;
        if (row < 0 || col < 0 || row >= MAX_ROWS || col >= MAX_COLS) return fail("#REF!");
        return { area: { c1: col, r1: row, c2: col, r2: row } };
      }
    }
    const reference = referenceFromText(toText(text));
    if (!reference) return fail("#REF!");
    if (reference.sheet !== undefined && !resolver.hasSheet(reference.sheet)) return fail("#REF!");
    return reference;
  }
  if (name === "OFFSET") {
    if (expr.args.length < 3 || expr.args.length > 5) return fail("#VALUE!");
    const base = referenceOf(expr.args[0], resolver, scope);
    if (!base) return fail("#VALUE!");
    if (isError(base)) return base;
    const numbersOf = expr.args
      .slice(1)
      .map((arg) => (arg.k === "str" && arg.v === "" ? null : toNumber(evaluate(arg, resolver, scope))));
    const problem = numbersOf.find((value): value is CellError => value !== null && isError(value));
    if (problem) return problem;
    const [dRow, dCol, height, width] = numbersOf as (number | null)[];
    const r1 = base.area.r1 + Math.trunc(dRow ?? 0);
    const c1 = base.area.c1 + Math.trunc(dCol ?? 0);
    const h = height === null || height === undefined ? base.area.r2 - base.area.r1 + 1 : Math.trunc(height);
    const w = width === null || width === undefined ? base.area.c2 - base.area.c1 + 1 : Math.trunc(width);
    if (h < 1 || w < 1) return fail("#REF!");
    const area = { c1, r1, c2: c1 + w - 1, r2: r1 + h - 1 };
    if (area.r1 < 0 || area.c1 < 0 || area.r2 >= MAX_ROWS || area.c2 >= MAX_COLS) return fail("#REF!");
    return { sheet: base.sheet, area };
  }
  return null;
}
const materialize = (reference: { sheet?: string; area: Area }, resolver: Resolver) =>
  evaluateArg({ k: "range", sheet: reference.sheet, area: reference.area }, resolver, undefined);

// TEILERGEBNIS: Funktionsnummern 1–11 (ohne gefilterte Zeilen) und 101–111 (auch ohne ausgeblendete Zeilen).
const SUBTOTAL_FUNCTIONS: Record<number, string> = {
  1: "AVERAGE",
  2: "COUNT",
  3: "COUNTA",
  4: "MAX",
  5: "MIN",
  6: "PRODUCT",
  7: "STDEV",
  8: "STDEV.P",
  9: "SUM",
  10: "VAR",
  11: "VAR.P",
};
const SUBTOTAL_FORMULA = /^=\s*(?:_xlfn\.)?(TEILERGEBNIS|SUBTOTAL|AGGREGAT|AGGREGATE)\s*\(/i;

// ---------- LAMBDA ----------

const OMITTED: Omitted = { kind: "omitted" };
let lambdaDepth = 0;

// LAMBDA aus einem Ausdruck: LAMBDA(…), Name eines gespeicherten LAMBDA oder ein Aufruf, der eines liefert.
function lambdaOf(expr: Expr, resolver: Resolver, scope: Scope): Lambda | CellError | null {
  if (expr.k === "name") {
    const bound = scope?.get(expr.v);
    return isBound(bound) && bound.kind === "lambda" ? bound : null;
  }
  if (expr.k === "call" && canonical(expr.name) === "LAMBDA") {
    if (!expr.args.length) return fail("#VALUE!");
    const params = expr.args.slice(0, -1);
    if (params.some((param) => param.k !== "name")) return fail("#VALUE!");
    const names = params.map((param) => (param as { v: string }).v);
    if (new Set(names).size !== names.length || names.length > 253) return fail("#VALUE!");
    return { kind: "lambda", params: names, body: expr.args[expr.args.length - 1], scope };
  }
  if (expr.k === "invoke" || (expr.k === "call" && canonical(expr.name) === "LET")) {
    // Curry: LAMBDA(x;LAMBDA(y;x+y))(1)(2) bzw. LET(…; LAMBDA(…)) als Ergebnis.
    if (expr.k === "call") {
      const local: Map<string, Binding> = new Map(scope ?? []);
      const args = expr.args;
      for (let index = 0; index + 1 < args.length; index += 2) {
        const variable = args[index];
        if (variable.k !== "name") return fail("#NAME?");
        const lambda = lambdaOf(args[index + 1], resolver, local);
        if (lambda && isError(lambda)) return lambda;
        local.set(variable.v, lambda ?? evaluateArg(args[index + 1], resolver, local));
      }
      return args.length ? lambdaOf(args[args.length - 1], resolver, local) : null;
    }
    const outer = lambdaOf(expr.fn, resolver, scope);
    if (!outer || isError(outer)) return outer;
    if (expr.args.length > outer.params.length) return fail("#VALUE!");
    const local: Map<string, Binding> = new Map(outer.scope ?? []);
    outer.params.forEach((param, index) => {
      const arg = expr.args[index];
      local.set(param, !arg || (arg.k === "str" && arg.v === "") ? OMITTED : evaluateArg(arg, resolver, scope));
    });
    return lambdaOf(outer.body, resolver, local);
  }
  return null;
}

function callLambda(lambda: Lambda, values: (Arg | Omitted)[], resolver: Resolver): Arg {
  if (values.length > lambda.params.length) return fail("#VALUE!");
  // Schutz vor endloser Verschachtelung.
  if (lambdaDepth > 400) return fail("#NUM!");
  const local: Map<string, Binding> = new Map(lambda.scope ?? []);
  lambda.params.forEach((param, index) => local.set(param, values[index] ?? OMITTED));
  lambdaDepth += 1;
  try {
    return evaluateArg(lambda.body, resolver, local);
  } finally {
    lambdaDepth -= 1;
  }
}

// Ergebnis eines LAMBDA als einzelner Wert (für Zellen von ZUORDNEN, MATRIXERSTELLEN …).
const single = (value: Arg): Value =>
  isGrid(value) ? (value.length === 1 && value[0].length === 1 ? value[0][0] : fail("#CALC!")) : value;

// ZUORDNEN, REDUCE, SCAN, NACHZEILE, NACHSPALTE, MATRIXERSTELLEN: letzter Parameter ist ein LAMBDA.
function lambdaHelper(name: string, args: Expr[], resolver: Resolver, scope: Scope): Arg {
  if (!args.length) return fail("#VALUE!");
  const lambda = lambdaOf(args[args.length - 1], resolver, scope);
  if (!lambda) return fail("#VALUE!");
  if (isError(lambda)) return lambda;
  const values = args
    .slice(0, -1)
    .map((arg) => (arg.k === "str" && arg.v === "" ? null : evaluateArg(arg, resolver, scope)));
  const grid = (value: Arg | null) => (value === null ? [[null]] : toGrid(value));
  switch (name) {
    case "MAP": {
      if (!values.length || lambda.params.length !== values.length) return fail("#VALUE!");
      const grids = values.map(grid);
      const rows = Math.max(...grids.map((item) => item.length));
      const cols = Math.max(...grids.map((item) => item[0]?.length ?? 0));
      if (rows * cols > 200_000) return fail("#NUM!");
      return Array.from({ length: rows }, (_, r) =>
        Array.from({ length: cols }, (_, c) =>
          single(
            callLambda(
              lambda,
              grids.map((item) =>
                item.length === 1 && item[0].length === 1 ? item[0][0] : (item[r]?.[c] ?? fail("#N/A")),
              ),
              resolver,
            ),
          ),
        ),
      );
    }
    case "REDUCE":
    case "SCAN": {
      if (values.length !== 2 || lambda.params.length !== 2) return fail("#VALUE!");
      let accumulator: Arg = values[0] === null ? null : values[0];
      const source = grid(values[1]);
      const steps: Value[][] = [];
      for (const line of source) {
        const out: Value[] = [];
        for (const value of line) {
          accumulator = callLambda(lambda, [accumulator, value], resolver);
          if (name === "SCAN") out.push(single(accumulator));
        }
        steps.push(out);
      }
      return name === "SCAN" ? steps : accumulator;
    }
    case "BYROW":
    case "BYCOL": {
      if (values.length !== 1 || lambda.params.length !== 1) return fail("#VALUE!");
      const source = grid(values[0]);
      const lines = name === "BYROW" ? source : (source[0] ?? []).map((_, c) => source.map((line) => line[c]));
      const results = lines.map((line) =>
        single(callLambda(lambda, [name === "BYROW" ? [line] : line.map((value) => [value])], resolver)),
      );
      return name === "BYROW" ? results.map((value) => [value]) : [results];
    }
    default: {
      // MATRIXERSTELLEN(Zeilen; Spalten; LAMBDA(z; s; …))
      if (values.length !== 2 || lambda.params.length !== 2) return fail("#VALUE!");
      const rows = toNumber(scalar(values[0] ?? null));
      const cols = toNumber(scalar(values[1] ?? null));
      if (isError(rows)) return rows;
      if (isError(cols)) return cols;
      const [r, c] = [Math.trunc(rows), Math.trunc(cols)];
      if (r < 1 || c < 1 || r * c > 200_000) return fail("#VALUE!");
      return Array.from({ length: r }, (_, row) =>
        Array.from({ length: c }, (_, col) => single(callLambda(lambda, [row + 1, col + 1], resolver))),
      );
    }
  }
}

function evaluateArg(expr: Expr, resolver: Resolver, scope: Scope): Arg {
  switch (expr.k) {
    case "num":
      return expr.v;
    case "str":
      return expr.v;
    case "bool":
      return expr.v;
    case "error":
      return fail(expr.code);
    case "name": {
      const bound = scope?.get(expr.v);
      if (bound === undefined) {
        const named = namedReference(expr, resolver, scope);
        return named ? evaluateArg(namedExpr(named), resolver, scope) : fail("#NAME?");
      }
      if (!isBound(bound)) return bound;
      // Ein LAMBDA als Wert ohne Aufruf ergibt #KALK! (wie Excel), ein ausgelassener Parameter ist leer.
      return bound.kind === "lambda" ? fail("#CALC!") : null;
    }
    case "spillref": {
      const reference = referenceOf(expr, resolver, scope);
      if (!reference) return fail("#REF!");
      return isError(reference) ? reference : materialize(reference, resolver);
    }
    case "invoke": {
      const lambda = lambdaOf(expr.fn, resolver, scope);
      if (!lambda) return fail("#VALUE!");
      if (isError(lambda)) return lambda;
      return callLambda(
        lambda,
        expr.args.map((arg) => (arg.k === "str" && arg.v === "" ? OMITTED : evaluateArg(arg, resolver, scope))),
        resolver,
      );
    }
    case "ref":
      if (expr.sheet !== undefined && !resolver.hasSheet(expr.sheet)) return fail("#REF!");
      return resolver.cell(expr.sheet, expr.col, expr.row);
    case "range": {
      if (expr.sheet !== undefined && !resolver.hasSheet(expr.sheet)) return fail("#REF!");
      const { c1, r1, c2 } = expr.area;
      const r2 = Math.min(expr.area.r2, Math.max(r1, (resolver.rows?.(expr.sheet) ?? MAX_ROWS) - 1));
      if ((r2 - r1 + 1) * (c2 - c1 + 1) > 200_000) return fail("#REF!");
      const grid: Grid = [];
      for (let row = r1; row <= r2; row += 1) {
        const line: Value[] = [];
        for (let col = c1; col <= c2; col += 1) line.push(resolver.cell(expr.sheet, col, row));
        grid.push(line);
      }
      return grid;
    }
    case "unary":
      return broadcast([evaluateArg(expr.arg, resolver, scope)], (value) => {
        const number = toNumber(value);
        if (isError(number)) return number;
        return expr.op === "-" ? -number : number;
      });
    case "percent":
      return broadcast([evaluateArg(expr.arg, resolver, scope)], (value) => {
        const number = toNumber(value);
        return isError(number) ? number : number / 100;
      });
    case "binary":
      return broadcast(
        [evaluateArg(expr.left, resolver, scope), evaluateArg(expr.right, resolver, scope)],
        (left, right) => binaryValue(expr.op, left, right),
      );
    case "call":
      return evaluateCall(expr, resolver, scope);
  }
}

function evaluateCall(expr: Extract<Expr, { k: "call" }>, resolver: Resolver, scope: Scope): Arg {
  const args = expr.args;
  // Name aus LET, an den ein LAMBDA gebunden ist: aufrufen.
  const local = scope?.get(expr.name.replace(/^_XLPM\./, ""));
  if (isBound(local) && local.kind === "lambda")
    return callLambda(
      local,
      args.map((arg) => (arg.k === "str" && arg.v === "" ? OMITTED : evaluateArg(arg, resolver, scope))),
      resolver,
    );
  const name = canonical(expr.name);
  // Funktionen, die mit dem Bezug selbst arbeiten (nicht nur mit den Werten).
  switch (name) {
    case "ROW":
    case "COLUMN":
    case "ROWS":
    case "COLUMNS": {
      if (args.length > 1) return fail("#VALUE!");
      if (!args[0]) {
        if (!resolver.self || name === "ROWS" || name === "COLUMNS") return fail("#VALUE!");
        return (name === "ROW" ? resolver.self.row : resolver.self.col) + 1;
      }
      const reference = referenceOf(args[0], resolver, scope);
      if (reference && isError(reference)) return reference;
      if (!reference) {
        // ZEILEN/SPALTEN auch für berechnete Bereiche (z. B. ZEILEN(FILTERN(…))).
        if (name !== "ROWS" && name !== "COLUMNS") return fail("#VALUE!");
        const value = evaluateArg(args[0], resolver, scope);
        if (isError(value)) return value;
        if (!isGrid(value)) return 1;
        return name === "ROWS" ? value.length : (value[0]?.length ?? 0);
      }
      const area = reference.area;
      if (name === "ROW") return area.r1 + 1;
      if (name === "COLUMN") return area.c1 + 1;
      return name === "ROWS" ? area.r2 - area.r1 + 1 : area.c2 - area.c1 + 1;
    }
    case "INDIRECT":
    case "OFFSET": {
      const reference = referenceOf(expr, resolver, scope);
      if (!reference) return fail("#REF!");
      return isError(reference) ? reference : materialize(reference, resolver);
    }
    case "ISREF": {
      if (args.length !== 1) return fail("#VALUE!");
      const reference = referenceOf(args[0], resolver, scope);
      return Boolean(reference) && !isError(reference);
    }
    case "ISFORMULA":
    case "FORMULATEXT": {
      if (args.length !== 1) return fail("#VALUE!");
      const reference = referenceOf(args[0], resolver, scope);
      if (!reference) return fail("#VALUE!");
      if (isError(reference)) return reference;
      const raw = resolver.raw?.(reference.sheet, reference.area.c1, reference.area.r1) ?? "";
      const formula = raw.startsWith("=") && raw.length > 1;
      if (name === "ISFORMULA") return formula;
      return formula ? raw : fail("#N/A");
    }
    case "SUBTOTAL": {
      if (args.length < 2) return fail("#VALUE!");
      const code = toNumber(evaluate(args[0], resolver, scope));
      if (isError(code)) return code;
      const kind = Math.trunc(code);
      const target = SUBTOTAL_FUNCTIONS[kind > 100 ? kind - 100 : kind];
      if (!target) return fail("#VALUE!");
      const grids: Arg[] = [];
      for (const arg of args.slice(1)) {
        const reference = referenceOf(arg, resolver, scope);
        if (!reference) return fail("#VALUE!");
        if (isError(reference)) return reference;
        const grid = materialize(reference, resolver);
        if (!isGrid(grid)) return grid;
        // Ausgeblendete Zeilen und andere Teilergebnisse zählen nicht mit.
        grids.push(
          grid
            .map((line, r) =>
              line.map((value, c) =>
                SUBTOTAL_FORMULA.test(
                  resolver.raw?.(reference.sheet, reference.area.c1 + c, reference.area.r1 + r) ?? "",
                )
                  ? null
                  : value,
              ),
            )
            .filter((_, r) => !resolver.rowHidden?.(reference.sheet, reference.area.r1 + r, kind > 100)),
        );
      }
      return FUNCTIONS[target](
        grids.map((grid) => (isGrid(grid) && !grid.length ? [[null]] : grid)),
        resolver,
      );
    }
    case "LET": {
      if (args.length < 3 || args.length % 2 === 0) return fail("#VALUE!");
      const local: Map<string, Binding> = new Map(scope ?? []);
      for (let index = 0; index < args.length - 1; index += 2) {
        const variable = args[index];
        if (variable.k !== "name") return fail("#NAME?");
        // LAMBDA unter einem Namen merken (dann „name(…)“ aufrufbar).
        const lambda = lambdaOf(args[index + 1], resolver, local);
        if (lambda && isError(lambda)) return lambda;
        local.set(variable.v, lambda ?? evaluateArg(args[index + 1], resolver, local));
      }
      return evaluateArg(args[args.length - 1], resolver, local);
    }
    case "LAMBDA": {
      // Ohne Aufruf ist ein LAMBDA kein Wert (Excel zeigt #KALK!).
      const lambda = lambdaOf(expr, resolver, scope);
      return lambda && isError(lambda) ? lambda : fail("#CALC!");
    }
    case "ISOMITTED": {
      if (args.length !== 1 || args[0].k !== "name") return fail("#VALUE!");
      const bound = scope?.get(args[0].v);
      return isBound(bound) && bound.kind === "omitted";
    }
    case "ANCHORARRAY": {
      const target = args[0];
      if (args.length !== 1 || target.k !== "ref") return fail("#VALUE!");
      return evaluateArg({ k: "spillref", sheet: target.sheet, col: target.col, row: target.row }, resolver, scope);
    }
    case "MAP":
    case "REDUCE":
    case "SCAN":
    case "BYROW":
    case "BYCOL":
    case "MAKEARRAY":
      return lambdaHelper(name, args, resolver, scope);
    case "IF": {
      if (args.length < 2 || args.length > 3) return fail("#VALUE!");
      const test = evaluateArg(args[0], resolver, scope);
      // Bedingung mit Bereich: je Zelle entscheiden (WENN(A1:A3>1;"ja";"nein")).
      if (isGrid(test) && !(test.length === 1 && test[0].length === 1))
        return broadcast(
          [test, evaluateArg(args[1], resolver, scope), args[2] ? evaluateArg(args[2], resolver, scope) : false],
          (condition, yes, no) => {
            const decided = truthy(condition);
            return isError(decided) ? decided : decided ? yes : no;
          },
        );
      // Sonst nur den gewählten Zweig rechnen (wie Excel).
      const decided = truthy(scalar(test));
      if (isError(decided)) return decided;
      if (decided) return evaluateArg(args[1], resolver, scope);
      return args.length > 2 ? evaluateArg(args[2], resolver, scope) : false;
    }
    case "IFERROR":
    case "IFNA": {
      if (args.length !== 2) return fail("#VALUE!");
      const value = evaluateArg(args[0], resolver, scope);
      const catches = (item: Value) => isError(item) && (name === "IFERROR" || item.error === "#N/A");
      if (isGrid(value) && !(value.length === 1 && value[0].length === 1)) {
        const fallback = evaluateArg(args[1], resolver, scope);
        return broadcast([value, fallback], (item, other) => (catches(item) ? other : item));
      }
      const single = scalar(value);
      return catches(single) ? evaluateArg(args[1], resolver, scope) : value;
    }
  }
  const impl = FUNCTIONS[name];
  if (!impl) return fail("#NAME?");
  return impl(
    args.map((arg) => evaluateArg(arg, resolver, scope)),
    resolver,
  );
}

// Funktionen, die einen ganzen Bereich liefern können (für das Überlaufen in Nachbarzellen).
const ARRAY_FUNCTIONS = new Set([
  "FILTER",
  "SORT",
  "SORTBY",
  "UNIQUE",
  "SEQUENCE",
  "TRANSPOSE",
  "RANDARRAY",
  "TEXTSPLIT",
  "VSTACK",
  "HSTACK",
  "TAKE",
  "DROP",
  "CHOOSECOLS",
  "CHOOSEROWS",
  "TOCOL",
  "TOROW",
  "EXPAND",
  "WRAPROWS",
  "WRAPCOLS",
  "INDIRECT",
  "OFFSET",
  "MMULT",
  "FREQUENCY",
  "MAP",
  "REDUCE",
  "SCAN",
  "BYROW",
  "BYCOL",
  "MAKEARRAY",
  "ANCHORARRAY",
]);
const PASS_THROUGH = new Set(["IF", "IFS", "IFERROR", "IFNA", "CHOOSE", "SWITCH", "LET", "XLOOKUP", "INDEX"]);

// Kann diese Formel einen Bereich liefern? (Nur dann wird geprüft, ob sie in Nachbarzellen überläuft.)
export function mayReturnArray(expr: Expr): boolean {
  switch (expr.k) {
    case "range":
    case "name":
    case "spillref":
    case "invoke":
      return true;
    case "unary":
    case "percent":
      return mayReturnArray(expr.arg);
    case "binary":
      return mayReturnArray(expr.left) || mayReturnArray(expr.right);
    case "call": {
      const name = canonical(expr.name);
      if (ARRAY_FUNCTIONS.has(name)) return true;
      if (PASS_THROUGH.has(name) || LIFTED.has(FUNCTIONS[name])) return expr.args.some(mayReturnArray);
      // Unbekannter Name: kann ein LAMBDA aus LET sein.
      return !isKnownFunction(name);
    }
    default:
      return false;
  }
}

// ---------- Umschreiben ----------

const SPECIAL_FUNCTIONS = new Set(["ROW", "COLUMN", "ROWS", "COLUMNS"]);
const isKnownFunction = (name: string) => {
  const english = canonical(name);
  return english in FUNCTIONS || SPECIAL_FUNCTIONS.has(english);
};

function rewrite(source: string, mapName: (name: string) => string, excel: boolean, defined?: Set<string>) {
  const tokens = tokenize(source);
  const sheetPrefix = (sheet: string | undefined) =>
    sheet === undefined ? "" : `${/^[A-Za-z_][\w.]*$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`}!`;
  let out = "";
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    switch (token.t) {
      case "num":
        out += String(token.v);
        break;
      case "str":
        out += `"${token.v.replace(/"/g, '""')}"`;
        break;
      case "ref": {
        const ref = `${sheetPrefix(token.sheet)}${token.v}`;
        // „A1#“ heisst in der Datei _xlfn.ANCHORARRAY(A1).
        out += token.spill ? (excel ? `_xlfn.ANCHORARRAY(${ref})` : `${ref}#`) : ref;
        break;
      }
      case "name": {
        const next = tokens[index + 1];
        if (next?.t === "(") {
          const upper = token.v.toUpperCase();
          const inner = tokens[index + 2];
          // _xlfn.ANCHORARRAY(A1) → A1#
          if (!excel && canonical(upper) === "ANCHORARRAY" && inner?.t === "ref" && tokens[index + 3]?.t === ")") {
            out += `${sheetPrefix(inner.sheet)}${inner.v}#`;
            index += 3;
            break;
          }
          // Aufruf eines LAMBDA aus LET: in der Datei mit „_xlpm.“.
          const bare = token.v.replace(/^_xlpm\./i, "");
          if (/^_xlpm\./i.test(token.v) || !isKnownFunction(upper)) {
            out += excel ? `_xlpm.${bare}` : bare;
            break;
          }
          out += mapName(upper);
          break;
        }
        const upper = token.v.toUpperCase();
        if (upper === "WAHR" || upper === "TRUE") out += excel ? "TRUE" : "WAHR";
        else if (upper === "FALSCH" || upper === "FALSE") out += excel ? "FALSE" : "FALSCH";
        else {
          // LET- und LAMBDA-Variablen: in der Datei mit „_xlpm.“ (benannte Bereiche ohne).
          const bare = token.v.replace(/^_xlpm\./i, "");
          out += excel && !defined?.has(bare.toUpperCase()) ? `_xlpm.${bare}` : bare;
        }
        break;
      }
      case "err":
        out += excel ? "#REF!" : "#BEZUG!";
        break;
      case "cols":
        out += token.v;
        break;
      case "op":
        out += token.v;
        break;
      case "sep":
        out += excel ? "," : ";";
        break;
      case "(":
        out += "(";
        break;
      case ")":
        out += ")";
        break;
    }
  }
  return out;
}

// Namen, die eine Formel selbst mit LET oder LAMBDA vergibt (in Grossbuchstaben).
function boundNames(expr: Expr, out = new Set<string>()): Set<string> {
  switch (expr.k) {
    case "call": {
      const name = canonical(expr.name);
      expr.args.forEach((arg, index) => {
        const declares =
          (name === "LET" && index % 2 === 0 && index < expr.args.length - 1) ||
          (name === "LAMBDA" && index < expr.args.length - 1);
        if (declares && arg.k === "name") out.add(arg.v.toUpperCase());
        boundNames(arg, out);
      });
      break;
    }
    case "invoke":
      boundNames(expr.fn, out);
      expr.args.forEach((arg) => boundNames(arg, out));
      break;
    case "binary":
      boundNames(expr.left, out);
      boundNames(expr.right, out);
      break;
    case "unary":
    case "percent":
      boundNames(expr.arg, out);
      break;
  }
  return out;
}

// Für die .xlsx-Datei: englische Namen und Komma (so speichert Excel Formeln intern).
// „defined“: benannte Bereiche der Arbeitsmappe (in Grossbuchstaben); Variablen aus LET/LAMBDA gehen vor.
export function toExcelFormula(source: string, defined?: Set<string>) {
  try {
    if (defined?.size) {
      let bound = new Set<string>();
      try {
        bound = boundNames(parseFormula(source));
      } catch {
        // Fehlerhafte Formel: Namen wie geschrieben übernehmen.
      }
      if (bound.size) defined = new Set([...defined].filter((name) => !bound.has(name)));
    }
    return rewrite(
      source,
      (name) => {
        const english = canonical(name);
        return XLWS.has(english) ? `_xlfn._xlws.${english}` : XLFN.has(english) ? `_xlfn.${english}` : english;
      },
      true,
      defined,
    );
  } catch {
    return null;
  }
}

// Aus einer .xlsx-Datei: deutsche Namen und Semikolon wie in der Oberfläche.
export function fromExcelFormula(source: string) {
  try {
    return rewrite(source, (name) => GERMAN_OF[canonical(name)] ?? canonical(name), false);
  } catch {
    return source;
  }
}

// Zellbezüge in einer Formel umschreiben (Text in Anführungszeichen bleibt unberührt). Für jeden Bezug oder
// Bereich liefert die Funktion den neuen Bezug oder null (dann „#BEZUG!“, wie in Excel nach dem Löschen).
export type RefInfo = { sheet?: string; col: number; row: number; absCol: boolean; absRow: boolean };
export type RefRange = { start: RefInfo; end: RefInfo | null };

const REF_PATTERN = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,6})(?![\w(!])/;
const quoteSheet = (sheet: string) =>
  /^[A-Za-zÄÖÜäöüß_][\wÄÖÜäöüß.]*$/.test(sheet) && !/^[A-Za-z]{1,3}\d+$/.test(sheet)
    ? sheet
    : `'${sheet.replace(/'/g, "''")}'`;
const refText = (ref: RefInfo) =>
  `${ref.absCol ? "$" : ""}${columnName(ref.col)}${ref.absRow ? "$" : ""}${ref.row + 1}`;

export function rewriteReferences(source: string, fn: (range: RefRange) => RefRange | null) {
  try {
    tokenize(source);
  } catch {
    return source;
  }
  const readRef = (at: number, sheet: string | undefined): [RefInfo, number] | null => {
    const match = REF_PATTERN.exec(source.slice(at));
    if (!match) return null;
    const col = columnIndex(match[2]);
    const row = Number(match[4]) - 1;
    if (col >= MAX_COLS || row >= MAX_ROWS) return null;
    return [{ sheet, col, row, absCol: match[1] === "$", absRow: match[3] === "$" }, at + match[0].length];
  };
  const readSheet = (at: number): [string, number] | null => {
    if (source[at] === "'") {
      const close = source.indexOf("'!", at + 1);
      return close < 0 ? null : [source.slice(at + 1, close).replace(/''/g, "'"), close + 2];
    }
    const word = /^[A-Za-zÄÖÜäöüß_][\wÄÖÜäöüß.]*!/.exec(source.slice(at));
    return word ? [word[0].slice(0, -1), at + word[0].length] : null;
  };
  let out = "";
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    if (char === '"') {
      let stop = i + 1;
      while (stop < source.length) {
        if (source[stop] === '"' && source[stop + 1] === '"') stop += 2;
        else if (source[stop] === '"') break;
        else stop += 1;
      }
      out += source.slice(i, stop + 1);
      i = stop + 1;
      continue;
    }
    const before = source[i - 1] ?? "";
    if (!NAME_CHAR.test(before) && before !== "$" && before !== "'") {
      const sheetPart = readSheet(i);
      const startAt = sheetPart ? sheetPart[1] : i;
      const first = readRef(startAt, sheetPart?.[0]);
      if (first) {
        let [start, next] = first;
        let end: RefInfo | null = null;
        if (source[next] === ":") {
          const endSheet = readSheet(next + 1);
          const second = readRef(endSheet ? endSheet[1] : next + 1, start.sheet);
          if (second) [end, next] = second;
        }
        const result = fn({ start, end });
        if (!result) out += "#BEZUG!";
        else {
          start = result.start;
          out += `${start.sheet !== undefined ? `${quoteSheet(start.sheet)}!` : ""}${refText(start)}${result.end ? `:${refText(result.end)}` : ""}`;
        }
        i = next;
        continue;
      }
    }
    if (NAME_CHAR.test(char)) {
      let word = "";
      while (i < source.length && NAME_CHAR.test(source[i])) word += source[i++];
      out += word;
      continue;
    }
    out += char;
    i += 1;
  }
  return out;
}

// Bezüge beim Kopieren/Einfügen oder Ausfüllen verschieben (A1 → B2), absolute Teile ($A$1) bleiben.
export function shiftFormula(source: string, dCol: number, dRow: number) {
  const move = (ref: RefInfo): RefInfo | null => {
    const col = ref.absCol ? ref.col : ref.col + dCol;
    const row = ref.absRow ? ref.row : ref.row + dRow;
    return col < 0 || row < 0 || col >= MAX_COLS || row >= MAX_ROWS ? null : { ...ref, col, row };
  };
  return rewriteReferences(source, ({ start, end }) => {
    const a = move(start);
    const b = end ? move(end) : null;
    return !a || (end && !b) ? null : { start: a, end: b };
  });
}

// Zeilen oder Spalten einfügen (count > 0) bzw. löschen (count < 0) ab „index“: Bezüge auf das betroffene Blatt
// wandern mit; Bezüge auf gelöschte Zellen werden „#BEZUG!“, Bereiche werden kleiner.
export function adjustForInsertDelete(
  source: string,
  axis: "row" | "col",
  index: number,
  count: number,
  affects: (sheet: string | undefined) => boolean,
) {
  const key = axis === "row" ? "row" : "col";
  return rewriteReferences(source, ({ start, end }) => {
    if (!affects(start.sheet)) return { start, end };
    if (count > 0) {
      const move = (ref: RefInfo) => (ref[key] >= index ? { ...ref, [key]: ref[key] + count } : ref);
      return { start: move(start), end: end ? move(end) : null };
    }
    const removed = -count;
    const last = index + removed - 1;
    const after = (ref: RefInfo) => (ref[key] > last ? { ...ref, [key]: ref[key] - removed } : ref);
    if (!end) return start[key] >= index && start[key] <= last ? null : { start: after(start), end: null };
    let a = start[key];
    let b = end[key];
    if (a >= index && b <= last) return null;
    if (a >= index && a <= last) a = index;
    else if (a > last) a -= removed;
    if (b >= index && b <= last) b = index - 1;
    else if (b > last) b -= removed;
    if (b < a) return null;
    return { start: { ...start, [key]: a }, end: { ...end, [key]: b } };
  });
}

// Blatt umbenennen: Bezüge aus anderen Blättern zeigen danach auf den neuen Namen.
export function renameSheetReferences(source: string, from: string, to: string) {
  const lower = from.toLocaleLowerCase("de-CH");
  return rewriteReferences(source, ({ start, end }) =>
    start.sheet !== undefined && start.sheet.toLocaleLowerCase("de-CH") === lower
      ? { start: { ...start, sheet: to }, end }
      : { start, end },
  );
}
