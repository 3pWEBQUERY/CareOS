import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeModels, stableKey } from "@/lib/office/merge";
import {
  DEFAULT_PAGE,
  newSheet,
  newSlide,
  type DeckModel,
  type DocNode,
  type DocumentModel,
  type SheetModel,
} from "@/lib/office/model";

const text = (value: string, marks?: DocNode["marks"]): DocNode => ({
  type: "text",
  text: value,
  ...(marks ? { marks } : {}),
});
const p = (...content: DocNode[]): DocNode => ({ type: "paragraph", ...(content.length ? { content } : {}) });
const doc = (...content: DocNode[]): DocumentModel => ({
  kind: "document",
  page: { ...DEFAULT_PAGE },
  content: { type: "doc", content },
});
const paragraphs = (model: DocumentModel) =>
  (model.content.content ?? []).map((node) =>
    (node.content ?? []).map((part) => part.text ?? `[${part.type}]`).join(""),
  );

test("Zusammenführen: Vergleich unabhängig von der Reihenfolge der Schlüssel", () => {
  assert.equal(stableKey({ a: 1, b: [1, { c: 2, d: 3 }] }), stableKey({ b: [1, { d: 3, c: 2 }], a: 1 }));
  assert.equal(stableKey({ a: 1, b: undefined }), stableKey({ a: 1 }));
});

test("Dokument: verschiedene Absätze, derselbe Absatz, neue Absätze und Löschen", () => {
  const base = doc(p(text("Erster Absatz")), p(text("Zweiter Absatz")), p(text("Dritter Absatz")));
  // Anna ändert den ersten, Beat den dritten Absatz.
  const mine = doc(p(text("Erster Absatz – geprüft")), p(text("Zweiter Absatz")), p(text("Dritter Absatz")));
  const theirs = doc(p(text("Erster Absatz")), p(text("Zweiter Absatz")), p(text("Dritter Absatz mit Nachtrag")));
  assert.deepEqual(paragraphs(mergeModels(base, mine, theirs) as DocumentModel), [
    "Erster Absatz – geprüft",
    "Zweiter Absatz",
    "Dritter Absatz mit Nachtrag",
  ]);
  // Beide schreiben im selben Absatz an verschiedenen Stellen.
  const sentence = doc(p(text("Blutdruck messen")), p(text("Zweiter Absatz")), p(text("Dritter Absatz")));
  const morning = { ...sentence, content: { ...sentence.content } };
  morning.content.content = [p(text("Am Morgen Blutdruck messen")), ...sentence.content.content!.slice(1)];
  const twice = { ...sentence, content: { ...sentence.content } };
  twice.content.content = [p(text("Blutdruck zweimal messen")), ...sentence.content.content!.slice(1)];
  assert.equal(
    paragraphs(mergeModels(sentence, morning, twice) as DocumentModel)[0],
    "Am Morgen Blutdruck zweimal messen",
  );
  // Beide fügen einen neuen Absatz ein, eine Seite löscht einen anderen.
  const added = doc(
    p(text("Erster Absatz")),
    p(text("Neu von Anna")),
    p(text("Zweiter Absatz")),
    p(text("Dritter Absatz")),
  );
  const deleted = doc(p(text("Erster Absatz")), p(text("Zweiter Absatz")), p(text("Neu von Beat")));
  assert.deepEqual(paragraphs(mergeModels(base, added, deleted) as DocumentModel), [
    "Erster Absatz",
    "Neu von Anna",
    "Zweiter Absatz",
    "Neu von Beat",
  ]);
  // Formatierung bleibt erhalten, gleich formatierte Zeichen werden wieder zu einem Textstück.
  const bold = [{ type: "bold" }];
  const formatted = doc(p(text("Wichtig", bold), text(" bitte lesen")));
  const plainBase = doc(p(text("Wichtig bitte lesen")));
  const appended = doc(p(text("Wichtig bitte lesen!")));
  const merged = mergeModels(plainBase, formatted, appended) as DocumentModel;
  assert.deepEqual(merged.content.content![0].content, [text("Wichtig", bold), text(" bitte lesen!")]);
});

test("Dokument: Seite, Kommentare mit Antworten und Erledigt", () => {
  const thread = { id: "k1", author: "Anna", date: "", text: "Prüfen", replies: [] };
  const base: DocumentModel = { ...doc(p(text("A"))), comments: [thread] };
  const mine: DocumentModel = {
    ...base,
    page: { ...base.page, header: "Haus Ahorn" },
    comments: [{ ...thread, replies: [{ id: "r1", author: "Anna", date: "", text: "Gemacht" }] }],
  };
  const theirs: DocumentModel = {
    ...base,
    page: { ...base.page, orientation: "landscape" },
    comments: [
      { ...thread, resolved: true },
      { id: "k2", author: "Beat", date: "", text: "Neu", replies: [] },
    ],
  };
  const merged = mergeModels(base, mine, theirs) as DocumentModel;
  assert.equal(merged.page.header, "Haus Ahorn");
  assert.equal(merged.page.orientation, "landscape");
  assert.deepEqual(
    merged.comments?.map((item) => [item.id, item.resolved ?? false, item.replies.length]),
    [
      ["k1", true, 1],
      ["k2", false, 0],
    ],
  );
});

test("Tabelle: Zellen, Spaltenbreiten, neue Blätter, Kommentare und Blattgrösse", () => {
  const sheet = newSheet("Liste");
  sheet.cells.A1 = { v: "Name" };
  sheet.cells.B1 = { v: "Zimmer" };
  const base: SheetModel = { kind: "sheet", sheets: [sheet] };
  const mine: SheetModel = {
    kind: "sheet",
    sheets: [
      {
        ...sheet,
        cells: { ...sheet.cells, A2: { v: "Anna" }, B1: { v: "Zimmer Nr." } },
        cols: { 0: 140 },
        rowCount: 200,
      },
    ],
  };
  const extra = newSheet("Notizen");
  const theirs: SheetModel = {
    kind: "sheet",
    sheets: [
      {
        ...sheet,
        cells: { A1: { v: "Name" }, B1: { v: "Raum" }, A3: { v: "Beat" } },
        comments: { A1: { id: "k", author: "Beat", date: "", text: "Sortieren?", replies: [] } },
        rowCount: 150,
      },
      extra,
    ],
  };
  const merged = mergeModels(base, mine, theirs) as SheetModel;
  const [first, second] = merged.sheets;
  assert.deepEqual(Object.fromEntries(Object.entries(first.cells).map(([key, cell]) => [key, cell.v])), {
    A1: "Name",
    B1: "Zimmer Nr.",
    A2: "Anna",
    A3: "Beat",
  });
  assert.equal(first.cols[0], 140);
  assert.equal(first.rowCount, 200);
  assert.equal(first.comments?.A1.text, "Sortieren?");
  assert.equal(second.name, "Notizen");
  // Gelöschte Zelle bleibt gelöscht, wenn die andere Seite sie nicht geändert hat.
  const removed: SheetModel = { kind: "sheet", sheets: [{ ...sheet, cells: { A1: { v: "Name" } } }] };
  const untouched: SheetModel = { kind: "sheet", sheets: [{ ...sheet, cells: { ...sheet.cells, C1: { v: "Neu" } } }] };
  assert.deepEqual(Object.keys((mergeModels(base, removed, untouched) as SheetModel).sheets[0].cells).sort(), [
    "A1",
    "C1",
  ]);
});

test("Präsentation: Folien, Objekte und Text auf derselben Folie, Reihenfolge, Löschen", () => {
  const one = { ...newSlide("title"), id: "s1", title: "Willkommen" };
  const two = { ...newSlide("content"), id: "s2", title: "Ablauf" };
  const box = {
    id: "t1",
    type: "text" as const,
    x: 10,
    y: 10,
    w: 100,
    h: 40,
    body: { type: "doc", content: [p(text("Notiz"))] },
  };
  const base: DeckModel = { kind: "deck", theme: "carecore", slides: [one, { ...two, items: [box] }] };
  const mine: DeckModel = {
    kind: "deck",
    theme: "wald",
    slides: [
      { ...two, items: [{ ...box, x: 50 }] },
      { ...one, title: "Willkommen im Team" },
    ],
  };
  const three = { ...newSlide("content"), id: "s3", title: "Fragen" };
  const theirs: DeckModel = {
    kind: "deck",
    theme: "carecore",
    slides: [
      one,
      { ...two, notes: "Kurz halten", items: [{ ...box, body: { type: "doc", content: [p(text("Notiz ergänzt"))] } }] },
      three,
    ],
  };
  const merged = mergeModels(base, mine, theirs) as DeckModel;
  assert.equal(merged.theme, "wald");
  assert.deepEqual(
    merged.slides.map((slide) => slide.id),
    ["s2", "s1", "s3"],
  );
  const merged2 = merged.slides[0];
  assert.equal(merged2.notes, "Kurz halten");
  const item = merged2.items[0];
  assert.equal(item.x, 50);
  assert.equal(item.type === "text" ? item.body.content?.[0].content?.[0].text : "", "Notiz ergänzt");
  assert.equal(merged.slides[1].title, "Willkommen im Team");
  // Folie gelöscht, die andere Seite hat sie nicht geändert: bleibt gelöscht.
  const without: DeckModel = { ...base, slides: [one] };
  assert.deepEqual(
    (mergeModels(base, without, { ...base, theme: "sand" }) as DeckModel).slides.map((slide) => slide.id),
    ["s1"],
  );
});
