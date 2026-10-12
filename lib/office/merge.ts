import type { CommentThread } from "./comments";
import type { DeckModel, DocNode, DocumentModel, OfficeModel, Sheet, SheetModel, Slide, SlideItem } from "./model";

// Gleichzeitiges Bearbeiten: zwei Fassungen (die eigene und die inzwischen gespeicherte) auf der gemeinsamen
// Ausgangsfassung zusammenführen. Was nur eine Seite geändert hat, bleibt erhalten; ändern beide dasselbe Stück
// (dieselbe Zelle, dasselbe Feld, dieselbe Textstelle), gilt die eigene Änderung.

type Json = unknown;

// Vergleich unabhängig von der Reihenfolge der Schlüssel (Browser und Server bauen Objekte unterschiedlich auf).
export function stableKey(value: Json): string {
  if (value === undefined) return "u";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableKey).join(",")}]`;
  const record = value as Record<string, Json>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableKey(record[key])}`)
    .join(",")}}`;
}
// Gleiche Objekte (unveränderte Teile teilen sich die Fassungen) ohne Umweg über den Text vergleichen.
const same = (a: Json, b: Json) => a === b || stableKey(a) === stableKey(b);

export function mergeValue<T>(base: T, mine: T, theirs: T): T {
  if (mine === base || theirs === mine) return theirs;
  if (theirs === base) return mine;
  if (same(mine, base)) return theirs;
  return mine;
}

// Je Schlüssel zusammenführen (Zellen, Spaltenbreiten, Kommentare je Zelle …); gelöschte Schlüssel bleiben gelöscht.
export function mergeRecord<T>(
  base: Record<string, T> | undefined,
  mine: Record<string, T> | undefined,
  theirs: Record<string, T> | undefined,
  entry: (base: T | undefined, mine: T | undefined, theirs: T | undefined) => T | undefined = mergeValue,
): Record<string, T> {
  const out: Record<string, T> = {};
  const keys = new Set([...Object.keys(base ?? {}), ...Object.keys(mine ?? {}), ...Object.keys(theirs ?? {})]);
  for (const key of keys) {
    const value = entry(base?.[key], mine?.[key], theirs?.[key]);
    if (value !== undefined) out[key] = value;
  }
  return out;
}

// Listen mit Kennung (Blätter, Folien, Objekte, Kommentare): Hinzufügen und Löschen beider Seiten, Reihenfolge der
// Seite, die sie geändert hat; Einträge, die beide behalten, werden selbst zusammengeführt.
export function mergeById<T extends { id: string }>(
  base: T[] | undefined,
  mine: T[] | undefined,
  theirs: T[] | undefined,
  item: (base: T, mine: T, theirs: T) => T = mergeValue,
): T[] {
  const b = base ?? [];
  const m = mine ?? [];
  const t = theirs ?? [];
  const inBase = new Map(b.map((entry) => [entry.id, entry]));
  const inMine = new Map(m.map((entry) => [entry.id, entry]));
  const inTheirs = new Map(t.map((entry) => [entry.id, entry]));
  const removed = (id: string) => inBase.has(id) && (!inMine.has(id) || !inTheirs.has(id));
  const ids = (list: T[]) => list.map((entry) => entry.id).filter((id) => inBase.has(id));
  // Reihenfolge: die Seite, die umsortiert hat; sonst die gespeicherte.
  const mineMoved = !same(
    ids(m),
    ids(b).filter((id) => inMine.has(id)),
  );
  const [lead, other] = mineMoved ? [m, t] : [t, m];
  const order = lead.map((entry) => entry.id).filter((id) => !removed(id));
  // Neu hinzugefügte Einträge der anderen Seite vor ihrem Nachfolger einfügen (am Ende Angefügtes bleibt am Ende).
  for (let index = other.length - 1; index >= 0; index -= 1) {
    const entry = other[index];
    if (inBase.has(entry.id) || order.includes(entry.id)) continue;
    let at = order.length;
    for (let next = index + 1; next < other.length; next += 1) {
      const position = order.indexOf(other[next].id);
      if (position >= 0) {
        at = position;
        break;
      }
    }
    order.splice(at, 0, entry.id);
  }
  return order.map((id) => {
    const before = inBase.get(id);
    const left = inMine.get(id);
    const right = inTheirs.get(id);
    if (before && left && right) return item(before, left, right);
    return (left ?? right)!;
  });
}

// ---------- Listen ohne Kennung (Absätze, Zeichen): Abgleich über die längste gemeinsame Folge ----------

function matches(a: string[], b: string[]): Map<number, number> {
  const found = new Map<number, number>();
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    found.set(start, start);
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  const tail: [number, number][] = [];
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
    tail.push([endA, endB]);
  }
  const n = endA - start;
  const m = endB - start;
  if (n > 0 && m > 0) {
    // Tabelle der längsten gemeinsamen Folge (nach dem Abschneiden gleicher Anfänge und Enden meist klein).
    const width = m + 1;
    const table = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i -= 1)
      for (let j = m - 1; j >= 0; j -= 1)
        table[i * width + j] =
          a[start + i] === b[start + j]
            ? table[(i + 1) * width + j + 1] + 1
            : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[start + i] === b[start + j]) {
        found.set(start + i, start + j);
        i += 1;
        j += 1;
      } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) i += 1;
      else j += 1;
    }
  }
  for (const [x, y] of tail) found.set(x, y);
  return found;
}

// Drei-Wege-Zusammenführung einer Folge: unveränderte Abschnitte gemeinsam, Änderungen einer Seite übernommen;
// ändern beide denselben Abschnitt, entscheidet „conflict“.
export function mergeSequence<T>(
  base: T[],
  mine: T[],
  theirs: T[],
  key: (value: T) => string,
  conflict: (base: T[], mine: T[], theirs: T[]) => T[],
): T[] {
  const kb = base.map(key);
  const km = mine.map(key);
  const kt = theirs.map(key);
  const toMine = matches(kb, km);
  const toTheirs = matches(kb, kt);
  const out: T[] = [];
  let i = 0;
  let a = 0;
  let b = 0;
  for (;;) {
    let j = i;
    while (j < base.length && !(toMine.has(j) && toTheirs.has(j) && toMine.get(j)! >= a && toTheirs.get(j)! >= b))
      j += 1;
    const end = j >= base.length;
    const ma = end ? mine.length : toMine.get(j)!;
    const tb = end ? theirs.length : toTheirs.get(j)!;
    const sb = kb.slice(i, j).join("\u0000");
    const sm = km.slice(a, ma).join("\u0000");
    const st = kt.slice(b, tb).join("\u0000");
    if (sm === sb) out.push(...theirs.slice(b, tb));
    else if (st === sb || st === sm) out.push(...mine.slice(a, ma));
    else out.push(...conflict(base.slice(i, j), mine.slice(a, ma), theirs.slice(b, tb)));
    if (end) break;
    out.push(mine[ma]);
    i = j + 1;
    a = ma + 1;
    b = tb + 1;
  }
  return out;
}

// ---------- Dokumentinhalt ----------

const TEXTBLOCKS = new Set(["paragraph", "heading"]);
type Token = { char?: string; marks?: DocNode["marks"]; node?: DocNode };

// Text eines Absatzes Zeichen für Zeichen (mit Formatierung), damit zwei Personen im selben Absatz schreiben können.
function tokens(content: DocNode[] | undefined): Token[] {
  const out: Token[] = [];
  for (const node of content ?? []) {
    if (node.type === "text" && typeof node.text === "string")
      for (const char of Array.from(node.text)) out.push({ char, marks: node.marks });
    else out.push({ node });
  }
  return out;
}
function fromTokens(list: Token[]): DocNode[] {
  const out: DocNode[] = [];
  for (const token of list) {
    if (token.node) {
      out.push(token.node);
      continue;
    }
    const last = out[out.length - 1];
    if (last?.type === "text" && same(last.marks, token.marks)) last.text = `${last.text}${token.char}`;
    else out.push({ type: "text", text: token.char, ...(token.marks?.length ? { marks: token.marks } : {}) });
  }
  return out;
}
const tokenKey = (token: Token) =>
  token.node ? `n${stableKey(token.node)}` : `c${token.char}${stableKey(token.marks)}`;

function mergeNode(base: DocNode, mine: DocNode, theirs: DocNode): DocNode {
  if (same(mine, base)) return theirs;
  if (same(theirs, base) || same(mine, theirs)) return mine;
  if (mine.type !== theirs.type || mine.type !== base.type) return mine;
  const attrs = mergeRecord(base.attrs, mine.attrs, theirs.attrs);
  const node: DocNode = { ...mine, ...(Object.keys(attrs).length ? { attrs } : {}) };
  if (TEXTBLOCKS.has(mine.type)) {
    const merged = mergeSequence(
      tokens(base.content),
      tokens(mine.content),
      tokens(theirs.content),
      tokenKey,
      (_b, m, t) => [...m, ...t],
    );
    const content = fromTokens(merged);
    return content.length ? { ...node, content } : { ...node, content: undefined };
  }
  if (mine.content || theirs.content)
    return { ...node, content: mergeBlocks(base.content, mine.content, theirs.content) };
  return node;
}

function mergeBlocks(base: DocNode[] = [], mine: DocNode[] = [], theirs: DocNode[] = []): DocNode[] {
  return mergeSequence(base, mine, theirs, stableKey, (b, m, t) => {
    // Absätze an gleicher Stelle einzeln zusammenführen (z. B. beide schreiben im selben Absatz); was eine Seite
    // gelöscht hat, bleibt gelöscht; neue Absätze beider Seiten bleiben erhalten.
    const n = Math.min(b.length, m.length, t.length);
    const head = m.slice(0, n).map((node, index) => mergeNode(b[index], node, t[index]));
    return [...head, ...m.slice(n), ...(t.length > b.length ? t.slice(Math.max(n, b.length)) : [])];
  });
}

export function mergeDocNode(base: DocNode, mine: DocNode, theirs: DocNode): DocNode {
  return mergeNode(base, mine, theirs);
}

// ---------- Kommentare ----------

const mergeThread = (base: CommentThread, mine: CommentThread, theirs: CommentThread): CommentThread => {
  const head = mergeRecord(
    base as unknown as Record<string, Json>,
    { ...mine, replies: undefined } as unknown as Record<string, Json>,
    { ...theirs, replies: undefined } as unknown as Record<string, Json>,
  ) as unknown as CommentThread;
  const replies = mergeById(base.replies, mine.replies, theirs.replies);
  const merged = { ...head, replies };
  if (!head.resolved) delete merged.resolved;
  return merged;
};
const mergeThreadEntry = (
  base: CommentThread | undefined,
  mine: CommentThread | undefined,
  theirs: CommentThread | undefined,
) => {
  if (!base) return mine ?? theirs;
  if (!mine || !theirs) return undefined;
  if (mine.id !== theirs.id) return mergeValue(base, mine, theirs);
  return mergeThread(base, mine, theirs);
};
const mergeThreads = (base?: CommentThread[], mine?: CommentThread[], theirs?: CommentThread[]) => {
  const merged = mergeById(base, mine, theirs, mergeThread);
  return merged.length ? merged : undefined;
};

// Felder eines Objekts einzeln; „special“ führt bestimmte Felder selbst zusammen.
function mergeFields<T extends object>(
  base: T,
  mine: T,
  theirs: T,
  special: { [K in keyof T]?: (base: T[K], mine: T[K], theirs: T[K]) => T[K] } = {},
): T {
  const out: Record<string, Json> = {};
  const b = base as Record<string, Json>;
  const m = mine as Record<string, Json>;
  const t = theirs as Record<string, Json>;
  for (const key of new Set([...Object.keys(b), ...Object.keys(m), ...Object.keys(t)])) {
    const own = (special as Record<string, ((x: Json, y: Json, z: Json) => Json) | undefined>)[key];
    const value = own ? own(b[key], m[key], t[key]) : mergeValue(b[key], m[key], t[key]);
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

// ---------- Tabelle ----------

function mergeSheet(base: Sheet, mine: Sheet, theirs: Sheet): Sheet {
  const record = <T>(b: Record<string, T>, m: Record<string, T>, t: Record<string, T>) => mergeRecord(b, m, t);
  return mergeFields(base, mine, theirs, {
    cells: record,
    cols: record,
    rows: record,
    rules: (b, m, t) => mergeById(b, m, t),
    charts: (b, m, t) => mergeById(b, m, t),
    // Zeilen- und Spaltenzahl: die grössere, damit niemandes Eingaben ausserhalb des Blatts liegen.
    rowCount: (b, m, t) => (m === b ? t : t === b ? m : Math.max(m, t)),
    colCount: (b, m, t) => (m === b ? t : t === b ? m : Math.max(m, t)),
    comments: (b, m, t) => {
      const merged = mergeRecord(b, m, t, mergeThreadEntry);
      return Object.keys(merged).length ? merged : undefined;
    },
  });
}

function mergeSheetModel(base: SheetModel, mine: SheetModel, theirs: SheetModel): SheetModel {
  const sheets = mergeById(base.sheets, mine.sheets, theirs.sheets, mergeSheet);
  const names = mergeValue(base.names, mine.names, theirs.names);
  return {
    kind: "sheet",
    sheets: sheets.length ? sheets : mine.sheets,
    ...(names ? { names: names.filter((entry) => sheets.some((sheet) => sheet.name === entry.sheet)) } : {}),
  };
}

// ---------- Präsentation ----------

function mergeItem(base: SlideItem, mine: SlideItem, theirs: SlideItem): SlideItem {
  if (mine.type !== theirs.type || mine.type !== base.type) return mine;
  if (mine.type === "text" && base.type === "text" && theirs.type === "text")
    return { ...mergeFields(base, mine, theirs), body: mergeDocNode(base.body, mine.body, theirs.body) };
  return mergeFields(base, mine, theirs);
}

function mergeSlide(base: Slide, mine: Slide, theirs: Slide): Slide {
  return mergeFields(base, mine, theirs, {
    body: mergeDocNode,
    body2: mergeDocNode,
    items: (b, m, t) => mergeById(b, m, t, mergeItem),
    comments: mergeThreads,
  });
}

function mergeDeck(base: DeckModel, mine: DeckModel, theirs: DeckModel): DeckModel {
  const slides = mergeById(base.slides, mine.slides, theirs.slides, mergeSlide);
  return {
    kind: "deck",
    theme: mergeValue(base.theme, mine.theme, theirs.theme),
    slides: slides.length ? slides : mine.slides,
  };
}

// ---------- Dokument ----------

function mergeDocument(base: DocumentModel, mine: DocumentModel, theirs: DocumentModel): DocumentModel {
  const comments = mergeThreads(base.comments, mine.comments, theirs.comments);
  return {
    kind: "document",
    page: mergeFields(base.page, mine.page, theirs.page),
    content: mergeDocNode(base.content, mine.content, theirs.content),
    ...(comments ? { comments } : {}),
    ...(mergeValue(base.track, mine.track, theirs.track) ? { track: true } : {}),
  };
}

export function mergeModels(base: OfficeModel, mine: OfficeModel, theirs: OfficeModel): OfficeModel {
  if (same(mine, base)) return theirs;
  if (same(theirs, base) || same(mine, theirs)) return mine;
  if (mine.kind !== theirs.kind || mine.kind !== base.kind) return mine;
  if (mine.kind === "document") return mergeDocument(base as DocumentModel, mine, theirs as DocumentModel);
  if (mine.kind === "sheet") return mergeSheetModel(base as SheetModel, mine, theirs as SheetModel);
  return mergeDeck(base as DeckModel, mine, theirs as DeckModel);
}
