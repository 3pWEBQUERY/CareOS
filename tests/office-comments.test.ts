import { test } from "node:test";
import assert from "node:assert/strict";
import { createZip, readZip } from "@/lib/zip";
import { cleanThreads, stampModelComments, stampThreads, type CommentThread } from "@/lib/office/comments";
import { buildDocx, readDocx } from "@/lib/office/docx";
import { buildPptx, readPptx } from "@/lib/office/pptx";
import { buildXlsx, readXlsx } from "@/lib/office/xlsx";
import {
  cleanModel,
  newSheet,
  newSlide,
  type DeckModel,
  type DocumentModel,
  type SheetModel,
} from "@/lib/office/model";
import { clearArea, duplicateSheet, insertDelete, sortArea } from "@/lib/office/sheet-ops";
import { findAll, parseXml, textOf } from "@/lib/office/xml";

const meta = { title: "Test", author: "Pflege Team" };
const foreign = (bytes: Buffer) => {
  const files = readZip(bytes);
  files.delete("carecore/model.json");
  return createZip([...files].map(([path, content]) => ({ path, content })));
};
const xml = (bytes: Buffer, part: string) => parseXml(readZip(bytes).get(part)!.toString("utf8"));

const thread = (): CommentThread => ({
  id: "k1",
  author: "Anna Muster",
  date: "2026-10-05T08:30:00Z",
  text: "Bitte Dosierung prüfen.",
  replies: [{ id: "k1a", author: "Beat Huber", date: "2026-10-05T09:00:00Z", text: "Erledigt, ist korrigiert." }],
});

test("Kommentare: Name und Zeit setzt der Server, fremde Einträge bleiben unverändert", () => {
  const before = [thread()];
  const next: CommentThread[] = [
    {
      ...thread(),
      author: "Fälschung",
      text: "Geänderter Text",
      resolved: true,
      replies: [
        { ...thread().replies[0], text: "Von Beat geändert" },
        { id: "k1b", author: "Fälschung", date: "1999-01-01T00:00:00Z", text: "Neue Antwort" },
      ],
    },
    { id: "k2", author: "", date: "", text: "Neuer Kommentar", replies: [] },
  ];
  const stamped = stampThreads(before, next, "Beat Huber", "2026-10-05T10:00:00Z");
  // Annas Kommentar: Name, Zeit und Text bleiben; erledigt darf jede Person setzen.
  assert.deepEqual(
    [stamped[0].author, stamped[0].date, stamped[0].text, stamped[0].resolved],
    ["Anna Muster", "2026-10-05T08:30:00Z", "Bitte Dosierung prüfen.", true],
  );
  // Eigene Antwort darf geändert werden, neue Antwort bekommt Name und Zeit des Servers.
  assert.equal(stamped[0].replies[0].text, "Von Beat geändert");
  assert.deepEqual([stamped[0].replies[1].author, stamped[0].replies[1].date], ["Beat Huber", "2026-10-05T10:00:00Z"]);
  assert.deepEqual([stamped[1].author, stamped[1].date], ["Beat Huber", "2026-10-05T10:00:00Z"]);
  // Ungültiges fällt beim Prüfen weg (leerer Text, fehlende Nummer, doppelte Antwort).
  assert.deepEqual(
    cleanThreads([
      { id: "a", text: "  " },
      { text: "ohne Nummer" },
      {
        id: "b",
        text: "gut",
        replies: [
          { id: "b", text: "doppelt" },
          { id: "c", text: "ok" },
        ],
      },
    ]).map((item) => [item.id, item.replies.map((reply) => reply.id)]),
    [["b", ["c"]]],
  );
  const sheet = newSheet("Tabelle1");
  sheet.comments = { B2: { ...thread(), id: "neu", author: "x" } };
  const model = stampModelComments(
    null,
    { kind: "sheet", sheets: [sheet] } as SheetModel,
    "Chris",
    "2026-10-05T11:00:00Z",
  );
  assert.equal(model.sheets[0].comments?.B2.author, "Chris");
});

const commentedDocument = (): DocumentModel => ({
  kind: "document",
  page: { orientation: "portrait", margins: "normal", header: "", footer: "", pageNumbers: false },
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Vor dem " },
          { type: "text", text: "Kommentar", marks: [{ type: "comment", attrs: { id: "k1" } }] },
        ],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "über zwei", marks: [{ type: "comment", attrs: { id: "k1" } }, { type: "bold" }] },
          { type: "text", text: " Absätze." },
        ],
      },
    ],
  },
  comments: [{ ...thread(), resolved: true }],
});

test("Word: Kommentare mit Antworten und „erledigt“ in comments.xml und commentsExtended.xml", () => {
  const model = commentedDocument();
  const bytes = buildDocx(model, meta);
  const document = xml(bytes, "word/document.xml");
  assert.deepEqual(
    findAll(document, "commentRangeStart").map((node) => node.attrs.id),
    ["0", "1"],
  );
  assert.equal(findAll(document, "commentReference").length, 2);
  // Bereich beginnt vor „Kommentar“ und endet nach „über zwei“.
  const body = readZip(bytes).get("word/document.xml")!.toString();
  assert.ok(body.indexOf('commentRangeStart w:id="0"') < body.indexOf(">Kommentar<"));
  assert.ok(body.indexOf('commentRangeEnd w:id="0"') > body.indexOf(">über zwei<"));
  const comments = xml(bytes, "word/comments.xml");
  assert.deepEqual(
    findAll(comments, "comment").map((node) => [node.attrs.author, node.attrs.initials, node.attrs.date]),
    [
      ["Anna Muster", "AM", "2026-10-05T08:30:00Z"],
      ["Beat Huber", "BH", "2026-10-05T09:00:00Z"],
    ],
  );
  const extended = findAll(xml(bytes, "word/commentsExtended.xml"), "commentEx");
  assert.equal(extended[1].attrs.paraIdParent, extended[0].attrs.paraId);
  assert.equal(extended[0].attrs.done, "1");
  assert.deepEqual(readDocx(bytes).model, cleanModel("document", model));

  const imported = readDocx(foreign(bytes)).model;
  assert.deepEqual(
    imported.comments?.map((item) => [item.author, item.text, item.resolved, item.replies.map((reply) => reply.text)]),
    [["Anna Muster", "Bitte Dosierung prüfen.", true, ["Erledigt, ist korrigiert."]]],
  );
  const id = imported.comments![0].id;
  const marked = (imported.content.content ?? []).flatMap((paragraph) =>
    (paragraph.content ?? []).filter((node) =>
      node.marks?.some((mark) => mark.type === "comment" && mark.attrs?.id === id),
    ),
  );
  assert.deepEqual(
    marked.map((node) => node.text),
    ["Kommentar", "über zwei"],
  );
});

test("Excel: Kommentare als Notizen (mit VML) und Lesen von Notizen und Unterhaltungen", () => {
  const sheet = newSheet("Tabelle1");
  sheet.cells.B2 = { v: "12" };
  sheet.comments = { B2: { ...thread(), resolved: true } };
  const model: SheetModel = { kind: "sheet", sheets: [sheet] };
  const bytes = buildXlsx(model, meta);
  const files = readZip(bytes);
  const note = findAll(xml(bytes, "xl/comments1.xml"), "comment")[0];
  assert.equal(note.attrs.ref, "B2");
  assert.equal(
    findAll(note, "t").map(textOf).join(""),
    "Anna Muster:\nBitte Dosierung prüfen.\n\nBeat Huber:\nErledigt, ist korrigiert.\n\n(erledigt)",
  );
  assert.match(files.get("xl/drawings/vmlDrawing1.vml")!.toString(), /<x:Row>1<\/x:Row><x:Column>1<\/x:Column>/);
  assert.match(files.get("xl/worksheets/sheet1.xml")!.toString(), /<legacyDrawing r:id="rId3"\/>/);
  assert.deepEqual(readXlsx(bytes).model, cleanModel("sheet", model));

  const imported = readXlsx(foreign(bytes)).model.sheets[0].comments?.B2;
  assert.deepEqual(
    [
      imported?.author,
      imported?.text,
      imported?.resolved,
      imported?.replies.map((reply) => [reply.author, reply.text]),
    ],
    ["Anna Muster", "Bitte Dosierung prüfen.", true, [["Beat Huber", "Erledigt, ist korrigiert."]]],
  );

  // Unterhaltung aus Excel 365 (threadedComments + persons).
  const raw = readZip(foreign(bytes));
  raw.set(
    "xl/threadedComments/threadedComment1.xml",
    Buffer.from(
      '<?xml version="1.0"?><ThreadedComments xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><threadedComment ref="C3" dT="2026-10-04T07:00:00.00" personId="{P1}" id="{T1}"><text>Neu bestellen</text></threadedComment><threadedComment ref="C3" dT="2026-10-04T08:00:00.00" personId="{P2}" id="{T2}" parentId="{T1}"><text>Ist bestellt</text></threadedComment></ThreadedComments>',
    ),
  );
  raw.set(
    "xl/persons/person.xml",
    Buffer.from(
      '<?xml version="1.0"?><personList xmlns="http://schemas.microsoft.com/office/spreadsheetml/2018/threadedcomments"><person displayName="Clara Weiss" id="{P1}"/><person displayName="Dario Rossi" id="{P2}"/></personList>',
    ),
  );
  raw.set(
    "xl/_rels/workbook.xml.rels",
    Buffer.from(
      raw
        .get("xl/_rels/workbook.xml.rels")!
        .toString()
        .replace(
          "</Relationships>",
          '<Relationship Id="rId99" Type="http://schemas.microsoft.com/office/2017/10/relationships/person" Target="persons/person.xml"/></Relationships>',
        ),
    ),
  );
  raw.set(
    "xl/worksheets/_rels/sheet1.xml.rels",
    Buffer.from(
      raw
        .get("xl/worksheets/_rels/sheet1.xml.rels")!
        .toString()
        .replace(
          "</Relationships>",
          '<Relationship Id="rId9" Type="http://schemas.microsoft.com/office/2017/10/relationships/threadedComment" Target="../threadedComments/threadedComment1.xml"/></Relationships>',
        ),
    ),
  );
  const threaded = readXlsx(createZip([...raw].map(([path, content]) => ({ path, content })))).model.sheets[0].comments;
  assert.deepEqual(
    [threaded?.C3.author, threaded?.C3.text, threaded?.C3.date, threaded?.C3.replies.map((reply) => reply.author)],
    ["Clara Weiss", "Neu bestellen", "2026-10-04T07:00:00Z", ["Dario Rossi"]],
  );
  assert.equal(threaded?.B2.author, "Anna Muster");
});

test("PowerPoint: Kommentare je Folie mit Antworten (klassisch) und Lesen des neuen Formats", () => {
  const slide = newSlide("title", "Hygiene");
  slide.comments = [thread()];
  const model: DeckModel = { kind: "deck", theme: "carecore", slides: [slide, newSlide("content", "Ohne")] };
  const bytes = buildPptx(model, meta);
  const files = readZip(bytes);
  assert.deepEqual(
    findAll(xml(bytes, "ppt/commentAuthors.xml"), "cmAuthor").map((node) => [
      node.attrs.name,
      node.attrs.initials,
      node.attrs.lastIdx,
    ]),
    [
      ["Anna Muster", "AM", "1"],
      ["Beat Huber", "BH", "1"],
    ],
  );
  const cms = findAll(xml(bytes, "ppt/comments/comment1.xml"), "cm");
  assert.deepEqual(
    cms.map((node) => textOf(findAll(node, "text")[0])),
    ["Bitte Dosierung prüfen.", "Erledigt, ist korrigiert."],
  );
  assert.equal(findAll(cms[1], "parentCm")[0].attrs.authorId, "0");
  assert.ok(!files.has("ppt/comments/comment2.xml"));
  assert.deepEqual(readPptx(bytes).model, cleanModel("deck", model));

  const imported = readPptx(foreign(bytes)).model.slides[0].comments;
  assert.deepEqual(
    imported?.map((item) => [item.author, item.text, item.replies.map((reply) => [reply.author, reply.text])]),
    [["Anna Muster", "Bitte Dosierung prüfen.", [["Beat Huber", "Erledigt, ist korrigiert."]]]],
  );

  // Neues Format (PowerPoint 365): modernComment + authors.xml, Status „erledigt“.
  const raw = readZip(foreign(bytes));
  raw.delete("ppt/comments/comment1.xml");
  raw.set(
    "ppt/comments/modernComment_1.xml",
    Buffer.from(
      '<?xml version="1.0"?><p188:cmLst xmlns:p188="http://schemas.microsoft.com/office/powerpoint/2018/8/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p188:cm id="{C1}" authorId="{A1}" created="2026-10-03T10:00:00.000" status="resolved"><p188:replyLst><p188:reply id="{R1}" authorId="{A2}" created="2026-10-03T11:00:00.000"><p188:txBody><a:bodyPr/><a:p><a:r><a:t>Passt</a:t></a:r></a:p></p188:txBody></p188:reply></p188:replyLst><p188:txBody><a:bodyPr/><a:p><a:r><a:t>Titel kürzer?</a:t></a:r></a:p></p188:txBody></p188:cm></p188:cmLst>',
    ),
  );
  raw.set(
    "ppt/authors.xml",
    Buffer.from(
      '<?xml version="1.0"?><p188:authorLst xmlns:p188="http://schemas.microsoft.com/office/powerpoint/2018/8/main"><p188:author id="{A1}" name="Eva Keller" initials="EK" userId="" providerId=""/><p188:author id="{A2}" name="Fritz Meier" initials="FM" userId="" providerId=""/></p188:authorLst>',
    ),
  );
  for (const [part, rel] of [
    [
      "ppt/slides/_rels/slide1.xml.rels",
      '<Relationship Id="rId4" Type="http://schemas.microsoft.com/office/2018/10/relationships/comments" Target="../comments/modernComment_1.xml"/>',
    ],
    [
      "ppt/_rels/presentation.xml.rels",
      '<Relationship Id="rId99" Type="http://schemas.microsoft.com/office/2018/10/relationships/authors" Target="authors.xml"/>',
    ],
  ])
    raw.set(
      part,
      Buffer.from(
        raw
          .get(part)!
          .toString()
          .replace(/<Relationship Id="rId4" Type="[^"]*\/comments" Target="[^"]*"\/>/, "")
          .replace("</Relationships>", `${rel}</Relationships>`),
      ),
    );
  const modern = readPptx(createZip([...raw].map(([path, content]) => ({ path, content })))).model.slides[0].comments;
  assert.deepEqual(
    modern?.map((item) => [
      item.author,
      item.text,
      item.resolved,
      item.date,
      item.replies.map((reply) => [reply.author, reply.text]),
    ]),
    [["Eva Keller", "Titel kürzer?", true, "2026-10-03T10:00:00Z", [["Fritz Meier", "Passt"]]]],
  );
});

test("Tabelle: Kommentare wandern beim Einfügen, Löschen und Sortieren mit ihrer Zelle", () => {
  const note = (id: string): CommentThread => ({ id, author: "A", date: "", text: id, replies: [] });
  const sheet = newSheet("Liste");
  sheet.cells.A1 = { v: "3" };
  sheet.cells.A2 = { v: "1" };
  sheet.cells.A3 = { v: "2" };
  sheet.comments = { A1: note("drei"), A2: note("eins"), B3: note("zwei") };
  const model: SheetModel = { kind: "sheet", sheets: [sheet] };
  const ids = (comments: Record<string, CommentThread> | undefined) =>
    Object.fromEntries(Object.entries(comments ?? {}).map(([key, thread]) => [key, thread.id]));
  // Zeile oberhalb von 2 einfügen: A2 → A3, B3 → B4.
  assert.deepEqual(ids(insertDelete(model, 0, "row", 1, 1).sheets[0].comments), { A1: "drei", A3: "eins", B4: "zwei" });
  // Zeile 2 löschen: ihr Kommentar fällt weg.
  assert.deepEqual(ids(insertDelete(model, 0, "row", 1, -1).sheets[0].comments), { A1: "drei", B2: "zwei" });
  // Spalte A löschen.
  assert.deepEqual(ids(insertDelete(model, 0, "col", 0, -1).sheets[0].comments), { A3: "zwei" });
  // Sortieren nach Spalte A (aufsteigend): Zeile 2 → 1, Zeile 3 → 2, Zeile 1 → 3.
  const sorted = sortArea(sheet, { c1: 0, r1: 0, c2: 1, r2: 2 }, 0, 1, (col, row) =>
    Number(sheet.cells[`${"AB"[col]}${row + 1}`]?.v ?? ""),
  );
  assert.deepEqual(ids(sorted.comments), { A3: "drei", A1: "eins", B2: "zwei" });
  // „Alles löschen“ entfernt Kommentare, „Inhalte löschen“ nicht.
  assert.deepEqual(ids(clearArea(sheet, { c1: 0, r1: 0, c2: 0, r2: 1 }, "all").comments), { B3: "zwei" });
  assert.equal(Object.keys(clearArea(sheet, { c1: 0, r1: 0, c2: 0, r2: 1 }, "content").comments ?? {}).length, 3);
  // Kopiertes Blatt: gleiche Stellen, aber eigene Nummern.
  const copy = duplicateSheet(model, 0, "Kopie").sheets[1].comments ?? {};
  assert.deepEqual(Object.keys(copy).sort(), ["A1", "A2", "B3"]);
  assert.notEqual(copy.A1.id, "drei");
  assert.equal(copy.A1.text, "drei");
});
