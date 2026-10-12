import { test } from "node:test";
import assert from "node:assert/strict";
import { createZip, readZip } from "@/lib/zip";
import { buildDocx, readDocx } from "@/lib/office/docx";
import { buildXlsx, readXlsx } from "@/lib/office/xlsx";
import { buildPptx, readPptx } from "@/lib/office/pptx";
import {
  OFFICE_TEMPLATES,
  cleanModel,
  newSheet,
  newSlide,
  plainText,
  templateModel,
  type DeckModel,
  type DocNode,
  type DocumentModel,
  type SheetModel,
} from "@/lib/office/model";
import { insertDelete, parseClipboard, renameSheet, sortArea, toDelimited } from "@/lib/office/sheet-ops";
import { parseXml, textOf, findAll } from "@/lib/office/xml";

const meta = { title: "Test", author: "Pflege Team" };
// Kleinstes gültiges PNG (1 × 1 Pixel).
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// Wie eine Datei, die in Word, Excel oder PowerPoint gespeichert wurde: ohne das eingebettete CareOS-Modell.
function foreign(bytes: Buffer) {
  const files = readZip(bytes);
  files.delete("carecore/model.json");
  return createZip([...files.entries()].map(([path, content]) => ({ path, content })));
}
const xml = (bytes: Buffer, part: string) => parseXml(readZip(bytes).get(part)!.toString("utf8"));

test("ZIP: Archiv lesen (gepackt und ungepackt) und Grenzen einhalten", () => {
  const zip = createZip([
    { path: "a.txt", content: Buffer.from("Hallo Ablage ".repeat(50)) },
    { path: "ordner/ä.bin", content: Buffer.from([1, 2, 3]) },
  ]);
  const files = readZip(zip);
  assert.equal(files.get("a.txt")?.toString(), "Hallo Ablage ".repeat(50));
  assert.deepEqual([...files.get("ordner/ä.bin")!], [1, 2, 3]);
  assert.throws(() => readZip(zip, 10));
  assert.throws(() => readZip(Buffer.from("kein zip")));
});

test("Vorlagen: jede Vorlage ergibt eine gültige Office-Datei, die sich unverändert wieder öffnen lässt", () => {
  for (const template of OFFICE_TEMPLATES) {
    const model = templateModel(template.id);
    const bytes =
      model.kind === "document"
        ? buildDocx(model, meta)
        : model.kind === "sheet"
          ? buildXlsx(model, meta)
          : buildPptx(model, meta);
    const files = readZip(bytes);
    assert.ok(files.has("[Content_Types].xml"), template.id);
    assert.ok(files.has("docProps/core.xml"), template.id);
    const back =
      model.kind === "document" ? readDocx(bytes) : model.kind === "sheet" ? readXlsx(bytes) : readPptx(bytes);
    assert.equal(back.imported, false, template.id);
    assert.deepEqual(back.model, cleanModel(model.kind, model), template.id);
  }
});

const richDocument = (): DocumentModel => ({
  kind: "document",
  page: {
    orientation: "landscape",
    margins: "narrow",
    header: "Haus Ahorn",
    footer: "Stand Oktober",
    pageNumbers: true,
  },
  content: {
    type: "doc",
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "Hygieneplan" }] },
      {
        type: "paragraph",
        attrs: { textAlign: "center" },
        content: [
          { type: "text", text: "Fett ", marks: [{ type: "bold" }] },
          { type: "text", text: "rot", marks: [{ type: "textStyle", attrs: { color: "#b42318", fontSize: "14pt" } }] },
          { type: "text", text: " & <Link>", marks: [{ type: "link", attrs: { href: "https://example.org" } }] },
        ],
      },
      {
        type: "bulletList",
        content: [
          { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Hände" }] }] },
          {
            type: "listItem",
            content: [
              { type: "paragraph", content: [{ type: "text", text: "Flächen" }] },
              {
                type: "orderedList",
                attrs: { start: 1 },
                content: [
                  { type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Bad" }] }] },
                ],
              },
            ],
          },
        ],
      },
      {
        type: "table",
        content: [
          {
            type: "tableRow",
            content: ["Was", "Wer"].map((text) => ({
              type: "tableHeader",
              content: [{ type: "paragraph", content: [{ type: "text", text }] }],
            })),
          },
          {
            type: "tableRow",
            content: [
              {
                type: "tableCell",
                attrs: { colspan: 2, rowspan: 1 },
                content: [{ type: "paragraph", content: [{ type: "text", text: "Alle" }] }],
              },
            ],
          },
        ],
      },
      { type: "pageBreak" },
      { type: "image", attrs: { src: PNG, alt: "Plan", width: 120 } },
    ],
  },
});

test("Word: Formatierung, Listen, Tabellen, Bilder, Seite und Kopf-/Fusszeile in der .docx-Datei", () => {
  const model = richDocument();
  const bytes = buildDocx(model, meta);
  const files = readZip(bytes);
  const document = xml(bytes, "word/document.xml");
  const text = findAll(document, "t").map(textOf).join("");
  assert.match(text, /Hygieneplan/);
  assert.match(text, /& <Link>/);
  assert.ok(findAll(document, "numPr").length >= 3, "Listen nummeriert");
  assert.equal(findAll(document, "tbl").length, 1);
  assert.equal(findAll(document, "gridSpan")[0]?.attrs.val, "2");
  assert.equal(findAll(document, "pgSz")[0]?.attrs.orient, "landscape");
  assert.ok(findAll(document, "br").some((node) => node.attrs.type === "page"));
  assert.ok([...files.keys()].some((path) => path.startsWith("word/media/bild")));
  assert.match(files.get("word/footer1.xml")!.toString(), /NUMPAGES/);
  assert.match(files.get("word/header1.xml")!.toString(), /Haus Ahorn/);
  // Bild nur einmal in der Datei: im Modell nur verknüpft.
  assert.ok(!files.get("carecore/model.json")!.toString().includes("base64"));
  assert.deepEqual(readDocx(bytes).model, cleanModel("document", model));
});

test("Word: Datei aus einem anderen Programm wird gelesen (Überschriften, Listen, Tabelle, Bild, Querformat)", () => {
  const { model, imported } = readDocx(foreign(buildDocx(richDocument(), meta)));
  assert.equal(imported, true);
  const types = (model.content.content ?? []).map((node) => node.type);
  assert.deepEqual(types, ["heading", "paragraph", "bulletList", "table", "pageBreak", "image"]);
  const paragraph = model.content.content![1];
  assert.equal(paragraph.attrs?.textAlign, "center");
  assert.deepEqual(paragraph.content?.[0].marks, [{ type: "bold" }]);
  assert.equal(paragraph.content?.[1].marks?.find((mark) => mark.type === "textStyle")?.attrs?.color, "#b42318");
  assert.equal(paragraph.content?.[2].marks?.find((mark) => mark.type === "link")?.attrs?.href, "https://example.org");
  const list = model.content.content![2];
  assert.equal(list.content?.length, 2);
  assert.equal(list.content?.[1].content?.[1].type, "orderedList");
  const table = model.content.content![3];
  assert.equal(table.content?.[0].content?.[0].type, "tableHeader");
  assert.equal(table.content?.[1].content?.[0].attrs?.colspan, 2);
  assert.match(String(model.content.content![5].attrs?.src), /^data:image\/png;base64,/);
  assert.equal(model.page.orientation, "landscape");
  assert.equal(model.page.margins, "narrow");
  assert.equal(plainText(model.content).includes("Flächen"), true);
});

const scholarlyDocument = (): DocumentModel => ({
  kind: "document",
  page: { orientation: "portrait", margins: "normal", header: "", footer: "", pageNumbers: false },
  content: {
    type: "doc",
    content: [
      { type: "tableOfContents" },
      { type: "heading", attrs: { level: 1, textAlign: null }, content: [{ type: "text", text: "Einleitung" }] },
      {
        type: "paragraph",
        attrs: { textAlign: null, lineHeight: "1.5" },
        content: [
          { type: "text", text: "H" },
          { type: "text", text: "2", marks: [{ type: "subscript" }] },
          { type: "text", text: "O und m" },
          { type: "text", text: "2", marks: [{ type: "superscript" }] },
          { type: "footnote", attrs: { text: "Quelle: Hygienerichtlinie 2026" } },
          { type: "text", text: " Ende." },
        ],
      },
      { type: "heading", attrs: { level: 2, textAlign: null }, content: [{ type: "text", text: "Ablauf" }] },
      {
        type: "paragraph",
        attrs: { textAlign: null, lineHeight: "2" },
        content: [
          { type: "text", text: "Zweiter Hinweis" },
          { type: "footnote", attrs: { text: "Siehe Anhang & Liste" } },
        ],
      },
    ],
  },
});

test("Word: Inhaltsverzeichnis, Zeilenabstand, hoch-/tiefgestellt und Fussnoten in der .docx-Datei", () => {
  const model = scholarlyDocument();
  const bytes = buildDocx(model, meta);
  const files = readZip(bytes);
  const document = xml(bytes, "word/document.xml");
  // Inhaltsverzeichnis als Word-Feld mit den Überschriften als Einträgen.
  assert.match(textOf(findAll(document, "instrText")[0]), /^ TOC \\o "1-3" \\h \\z \\u $/);
  const styles = findAll(document, "pStyle").map((node) => node.attrs.val);
  assert.deepEqual(styles.slice(0, 3), ["Inhaltsverzeichnisberschrift", "Verzeichnis1", "Verzeichnis2"]);
  const fields = findAll(document, "fldChar").map((node) => node.attrs.fldCharType);
  assert.deepEqual(fields, ["begin", "separate", "end"]);
  // Zeilenabstand als Vielfaches von 240.
  assert.deepEqual(
    findAll(document, "spacing").map((node) => [node.attrs.line, node.attrs.lineRule]),
    [
      ["360", "auto"],
      ["480", "auto"],
    ],
  );
  const vert = findAll(document, "vertAlign").map((node) => node.attrs.val);
  assert.deepEqual(vert, ["subscript", "superscript"]);
  // Fussnoten in eigener Datei, im Text nur der Verweis.
  assert.deepEqual(
    findAll(document, "footnoteReference").map((node) => node.attrs.id),
    ["1", "2"],
  );
  const notes = parseXml(files.get("word/footnotes.xml")!.toString());
  const normal = findAll(notes, "footnote").filter((note) => !note.attrs.type);
  assert.deepEqual(
    normal.map((note) => findAll(note, "t").map(textOf).join("").trim()),
    ["Quelle: Hygienerichtlinie 2026", "Siehe Anhang & Liste"],
  );
  assert.match(
    files.get("word/_rels/document.xml.rels")!.toString(),
    /relationships\/footnotes" Target="footnotes.xml"/,
  );
  assert.match(files.get("[Content_Types].xml")!.toString(), /footnotes\+xml/);
  assert.match(files.get("word/styles.xml")!.toString(), /footnote reference/);
  assert.deepEqual(readDocx(bytes).model, cleanModel("document", model));
});

test("Word: fremde Datei mit Inhaltsverzeichnis, Fussnoten und Zeilenabstand wird gelesen", () => {
  const { model, imported } = readDocx(foreign(buildDocx(scholarlyDocument(), meta)));
  assert.equal(imported, true);
  const content = model.content.content ?? [];
  assert.deepEqual(
    content.map((node) => node.type),
    ["tableOfContents", "heading", "paragraph", "heading", "paragraph"],
  );
  const first = content[2];
  assert.equal(first.attrs?.lineHeight, "1.5");
  assert.deepEqual(first.content?.[1].marks, [{ type: "subscript" }]);
  assert.deepEqual(first.content?.[3].marks, [{ type: "superscript" }]);
  assert.deepEqual(first.content?.[4], { type: "footnote", attrs: { text: "Quelle: Hygienerichtlinie 2026" } });
  assert.equal(content[4].attrs?.lineHeight, "2");
  assert.equal(content[4].content?.[1].attrs?.text, "Siehe Anhang & Liste");
  // Standardabstand (1,15) bleibt ohne eigene Angabe.
  assert.equal(content[1].attrs?.lineHeight, undefined);
});

test("Word: Inhaltsverzeichnis über mehrere Absätze mit Seitenzahl-Feldern wird ein Verzeichnis", () => {
  const field = (type: string) => `<w:r><w:fldChar w:fldCharType="${type}"/></w:r>`;
  const instr = (text: string) => `<w:r><w:instrText xml:space="preserve">${text}</w:instrText></w:r>`;
  const entry = (text: string, first = false, last = false) =>
    `<w:p><w:pPr><w:pStyle w:val="TOC1"/></w:pPr>${first ? field("begin") + instr(' TOC \\o "1-3" ') + field("separate") : ""}<w:r><w:t>${text}</w:t></w:r>${field("begin")}${instr(" PAGEREF _Toc1 \\h ")}${field("separate")}<w:r><w:t>2</w:t></w:r>${field("end")}${last ? field("end") : ""}</w:p>`;
  const files = readZip(buildDocx(scholarlyDocument(), meta));
  files.delete("carecore/model.json");
  files.set(
    "word/document.xml",
    Buffer.from(
      `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:sdt><w:sdtContent><w:p><w:pPr><w:pStyle w:val="Inhaltsverzeichnisberschrift"/></w:pPr><w:r><w:t>Inhalt</w:t></w:r></w:p>${entry("Einleitung", true)}${entry("Ablauf", false, true)}</w:sdtContent></w:sdt><w:p><w:r><w:t>Nachher</w:t></w:r></w:p></w:body></w:document>`,
    ),
  );
  const { model } = readDocx(createZip([...files].map(([path, content]) => ({ path, content }))));
  assert.deepEqual(
    (model.content.content ?? []).map((node) => node.type),
    ["tableOfContents", "paragraph"],
  );
  assert.equal(plainText(model.content).trim(), "Nachher");
});

test("Excel: Werte, Formeln (englisch in der Datei), Formate, Blätter, Spaltenbreiten, verbundene Zellen", () => {
  const sheet = newSheet("Lager");
  sheet.cells.A1 = { v: "Artikel", s: { b: true, fill: "#eaf1ff", border: true } };
  sheet.cells.A2 = { v: "Handschuhe" };
  sheet.cells.B2 = { v: "12.5", s: { fmt: "chf" } };
  sheet.cells.B3 = { v: "=SUMME(B2:B2)*2", s: { fmt: "chf" } };
  sheet.cells.C2 = { v: "04.10.2026", s: { fmt: "date" } };
  sheet.cells.D2 = { v: "'007" };
  sheet.cells.E2 = { v: '=WENN(B2>10;"teuer";"günstig")' };
  sheet.cols["0"] = 220;
  sheet.merges = ["A5:C5"];
  sheet.freeze = { rows: 1, cols: 0 };
  const other = newSheet("Mai 2026");
  other.cells.A1 = { v: "=Lager!B3+1" };
  const model: SheetModel = { kind: "sheet", sheets: [sheet, other] };
  const bytes = buildXlsx(model, meta);
  const lager = xml(bytes, "xl/worksheets/sheet1.xml");
  const cell = (ref: string) => findAll(lager, "c").find((node) => node.attrs.r === ref)!;
  assert.equal(textOf(findAll(cell("B3"), "f")[0]), "SUM(B2:B2)*2");
  assert.equal(textOf(findAll(cell("B3"), "v")[0]), "25");
  assert.equal(cell("E2").attrs.t, "str");
  assert.equal(textOf(findAll(cell("E2"), "v")[0]), "teuer");
  assert.equal(cell("D2").attrs.t, "inlineStr");
  assert.equal(findAll(lager, "mergeCell")[0].attrs.ref, "A5:C5");
  assert.equal(findAll(lager, "pane")[0].attrs.ySplit, "1");
  assert.match(readZip(bytes).get("xl/styles.xml")!.toString(), /CHF/);
  assert.equal(textOf(findAll(xml(bytes, "xl/worksheets/sheet2.xml"), "v")[0]), "26");
  assert.deepEqual(readXlsx(bytes).model, cleanModel("sheet", model));

  const imported = readXlsx(foreign(bytes));
  assert.equal(imported.imported, true);
  const [back, backOther] = imported.model.sheets;
  assert.equal(back.name, "Lager");
  assert.equal(back.cells.B3.v, "=SUMME(B2:B2)*2");
  assert.equal(back.cells.E2.v, '=WENN(B2>10;"teuer";"günstig")');
  assert.equal(back.cells.D2.v, "'007");
  assert.equal(back.cells.A1.s?.b, true);
  assert.equal(back.cells.A1.s?.fill, "#eaf1ff");
  assert.equal(back.cells.B2.s?.fmt, "chf");
  assert.equal(back.cells.C2.s?.fmt, "date");
  assert.equal(back.cols["0"], 220);
  assert.deepEqual(back.merges, ["A5:C5"]);
  assert.deepEqual(back.freeze, { rows: 1, cols: 0 });
  assert.equal(backOther.cells.A1.v, "=Lager!B3+1");
});

test("Excel: Rahmen, Ausrichtung, Filter, Regeln, Auswahllisten, Diagramme und Druck in der .xlsx-Datei", () => {
  const sheet = newSheet("Pflege Daten");
  const rows = [
    ["Name", "Bereich", "Stunden"],
    ["Anna", "Pflege", "8"],
    ["Ben", "Küche", "6"],
    ["Cem", "Pflege", "4"],
    ["Dora", "Pflege", "10"],
  ];
  rows.forEach((line, r) => line.forEach((v, c) => (sheet.cells[`${"ABC"[c]}${r + 1}`] = { v })));
  sheet.cells.A1.s = { b: true, valign: "middle", bb: true, bw: "thick", bc: "#4472c4", font: "Arial" };
  sheet.cells.C2.s = { indent: 2, align: "left", bt: true, bl: true, valign: "top" };
  sheet.hiddenCols = [5];
  sheet.hiddenRows = [8];
  sheet.filter = { range: "A1:C5", hidden: { "1": ["Küche"] } };
  sheet.validations = [{ range: "B2:B20", values: ["Pflege", "Küche", "Technik"] }];
  sheet.rules = [
    { id: "a", range: "C2:C5", op: "gt", value: "5", value2: "", style: { fill: "#ffc7ce", color: "#9c0006" } },
    { id: "b", range: "A2:A5", op: "contains", value: "an", value2: "", style: { b: true } },
    { id: "c", range: "B2:B5", op: "duplicate", value: "", value2: "", style: { fill: "#ffeb9c" } },
    { id: "d", range: "C2:C5", op: "between", value: "1", value2: "5", style: { color: "#006100" } },
  ];
  sheet.charts = [
    { id: "x", type: "column", range: "A1:C5", title: "Stunden", x: 420, y: 30, w: 480, h: 300 },
    { id: "y", type: "pie", range: "A1:C5", title: "", x: 420, y: 360, w: 400, h: 280 },
  ];
  sheet.print = { orientation: "landscape", fit: true, gridlines: true };
  sheet.showGrid = false;
  const model: SheetModel = { kind: "sheet", sheets: [sheet] };
  const bytes = buildXlsx(model, meta);
  const files = readZip(bytes);
  assert.ok(files.has("xl/charts/chart1.xml") && files.has("xl/charts/chart2.xml"));
  assert.ok(files.has("xl/drawings/drawing1.xml"));
  const chart = xml(bytes, "xl/charts/chart1.xml");
  assert.equal(findAll(chart, "ser").length, 1, "Textspalten sind keine Datenreihe");
  assert.equal(textOf(findAll(findAll(chart, "val")[0], "f")[0]), "'Pflege Daten'!$C$2:$C$5");
  const page = xml(bytes, "xl/worksheets/sheet1.xml");
  assert.equal(findAll(page, "autoFilter")[0].attrs.ref, "A1:C5");
  assert.deepEqual(
    findAll(findAll(page, "filterColumn")[0], "filter").map((node) => node.attrs.val),
    ["Pflege"],
  );
  const row = (r: number) => findAll(page, "row").find((node) => node.attrs.r === String(r));
  assert.equal(row(3)?.attrs.hidden, "1", "gefilterte Zeile ist ausgeblendet");
  assert.equal(row(9)?.attrs.hidden, "1");
  assert.equal(findAll(page, "col").find((node) => node.attrs.min === "6")?.attrs.hidden, "1");
  assert.equal(findAll(page, "cfRule").length, 4);
  assert.equal(findAll(page, "sheetView")[0].attrs.showGridLines, "0");
  assert.equal(findAll(page, "pageSetup")[0].attrs.orientation, "landscape");
  assert.match(files.get("xl/styles.xml")!.toString(), /<bottom style="thick"><color rgb="FF4472C4"\/>/);
  assert.match(files.get("xl/styles.xml")!.toString(), /indent="2"/);
  assert.match(files.get("xl/workbook.xml")!.toString(), /_xlnm\._FilterDatabase/);
  assert.deepEqual(readXlsx(bytes).model, cleanModel("sheet", model));

  const back = readXlsx(foreign(bytes)).model.sheets[0];
  assert.deepEqual(back.cells.A1.s, sheet.cells.A1.s);
  assert.deepEqual(back.cells.C2.s, sheet.cells.C2.s);
  assert.deepEqual(back.hiddenCols, [5]);
  assert.deepEqual(back.hiddenRows, [8]);
  assert.deepEqual(back.filter, sheet.filter);
  assert.deepEqual(back.validations, sheet.validations);
  assert.deepEqual(
    back.rules.map(({ op, range, value, value2, style }) => ({ op, range, value, value2, style })),
    sheet.rules.map(({ op, range, value, value2, style }) => ({ op, range, value, value2, style })),
  );
  assert.deepEqual(back.print, sheet.print);
  assert.equal(back.showGrid, false);
  // Diagramme kommen auch ohne CareOS-Modell zurück (wie aus Excel).
  assert.deepEqual(
    back.charts.map(({ type, range, title, x, y, w, h }) => ({ type, range, title, x, y, w, h })),
    sheet.charts.map(({ type, range, title, x, y, w, h }) => ({ type, range, title, x, y, w, h })),
  );
});

test("Tabelle: Einfügen und Löschen verschiebt Filter, Regeln, Auswahllisten und ausgeblendete Zeilen", () => {
  const sheet = newSheet("Daten");
  sheet.hiddenRows = [2, 6];
  sheet.filter = { range: "A2:C8", hidden: { "2": ["x"] } };
  sheet.validations = [{ range: "B3:B9", values: ["Ja", "Nein"] }];
  sheet.rules = [{ id: "a", range: "C3:C4", op: "empty", value: "", value2: "", style: { b: true } }];
  sheet.charts = [{ id: "c", type: "line", range: "A2:C8", title: "", x: 0, y: 0, w: 300, h: 200 }];
  const inserted = insertDelete({ kind: "sheet", sheets: [sheet] }, 0, "row", 1, 2).sheets[0];
  assert.deepEqual(inserted.hiddenRows, [4, 8]);
  assert.equal(inserted.filter?.range, "A4:C10");
  assert.equal(inserted.validations[0].range, "B5:B11");
  assert.equal(inserted.rules[0].range, "C5:C6");
  assert.equal(inserted.charts[0].range, "A4:C10");
  const columns = insertDelete({ kind: "sheet", sheets: [sheet] }, 0, "col", 0, -1).sheets[0];
  assert.deepEqual(columns.filter, { range: "A2:B8", hidden: { "1": ["x"] } });
  assert.equal(columns.validations[0].range, "A3:A9");
  const removed = insertDelete({ kind: "sheet", sheets: [sheet] }, 0, "row", 2, -2).sheets[0];
  assert.equal(removed.rules.length, 0, "Regel auf gelöschten Zeilen fällt weg");
  assert.deepEqual(removed.hiddenRows, [4]);
});

test("PowerPoint: Folien, Layouts, Design, Bild und Notizen in der .pptx-Datei", () => {
  const title = newSlide("title", "Schulung", [], "Hygiene");
  const content = newSlide("content", "Inhalte", ["Hände", "Flächen"]);
  content.notes = "Zuerst die Hände.";
  const picture = newSlide("image", "Praxis", ["Ablauf"]);
  picture.image = PNG;
  const model: DeckModel = { kind: "deck", theme: "wald", slides: [title, content, picture] };
  const bytes = buildPptx(model, meta);
  const files = readZip(bytes);
  assert.equal(findAll(xml(bytes, "ppt/presentation.xml"), "sldId").length, 3);
  assert.ok(files.has("ppt/media/folie3.png"));
  assert.ok(files.has("ppt/notesSlides/notesSlide2.xml"));
  const second = findAll(xml(bytes, "ppt/slides/slide2.xml"), "t").map(textOf);
  assert.deepEqual(second, ["Inhalte", "Hände", "Flächen"]);
  assert.deepEqual(readPptx(bytes).model, cleanModel("deck", model));

  const imported = readPptx(foreign(bytes));
  assert.equal(imported.imported, true);
  const slides = imported.model.slides;
  assert.equal(slides.length, 3);
  assert.equal(slides[0].title, "Schulung");
  assert.equal(slides[1].title, "Inhalte");
  assert.equal(slides[1].body.content?.[0].type, "bulletList");
  assert.equal(slides[1].notes, "Zuerst die Hände.");
  assert.equal(slides[2].layout, "image");
  assert.match(slides[2].image, /^data:image\/png;base64,/);
});

const objectsDeck = (): DeckModel => {
  const slide = newSlide("blank", "Kennzahlen");
  slide.items = [
    {
      id: "t1",
      type: "text",
      x: 609_600,
      y: 1_645_920,
      w: 3_657_600,
      h: 914_400,
      body: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Freies Textfeld" }] }] },
    },
    {
      id: "s1",
      type: "shape",
      shape: "roundRect",
      x: 4_572_000,
      y: 1_645_920,
      w: 2_286_000,
      h: 1_371_600,
      fill: "#2563eb",
      line: "",
      text: "Wichtig",
    },
    {
      id: "s2",
      type: "shape",
      shape: "line",
      x: 609_600,
      y: 3_200_400,
      w: 3_000_000,
      h: 0,
      fill: "",
      line: "#be185d",
      text: "",
    },
    {
      id: "tb",
      type: "table",
      x: 609_600,
      y: 3_657_600,
      w: 5_486_400,
      h: 1_371_600,
      header: true,
      rows: [
        ["Wohnbereich", "Plätze"],
        ["Ahorn", "24"],
        ["Linde", "18"],
      ],
    },
    {
      id: "c1",
      type: "chart",
      chart: "column",
      x: 6_400_800,
      y: 3_200_400,
      w: 5_181_600,
      h: 3_200_400,
      title: "Belegung",
      categories: ["Jan", "Feb", "Mär"],
      series: [
        { name: "Ahorn", values: [22, 23, 24] },
        { name: "Linde", values: [17, 18, 16.5] },
      ],
    },
  ];
  return { kind: "deck", theme: "carecore", slides: [slide] };
};

test("PowerPoint: Textfelder, Formen, Tabellen und Diagramme auf der Folie", () => {
  const model = objectsDeck();
  const bytes = buildPptx(model, meta);
  const files = readZip(bytes);
  const slide = xml(bytes, "ppt/slides/slide1.xml");
  const geometries = findAll(slide, "prstGeom").map((node) => node.attrs.prst);
  assert.ok(geometries.includes("roundRect"));
  assert.ok(geometries.includes("line"));
  assert.equal(findAll(slide, "cxnSp").length, 1);
  const table = findAll(slide, "tbl")[0];
  assert.equal(findAll(table, "tr").length, 3);
  assert.deepEqual(findAll(findAll(table, "tr")[1], "t").map(textOf), ["Ahorn", "24"]);
  assert.equal(findAll(slide, "chart").length, 1);
  // Diagramm als eigener Teil mit den Werten und einer Arbeitsmappe zum Bearbeiten der Daten.
  const chart = xml(bytes, "ppt/charts/chart1.xml");
  assert.equal(findAll(chart, "barDir")[0].attrs.val, "col");
  assert.deepEqual(
    findAll(findAll(chart, "ser")[1], "val").flatMap((node) => findAll(node, "v").map(textOf)),
    ["17", "18", "16.5"],
  );
  assert.equal(textOf(findAll(chart, "f")[0]), "Tabelle1!$B$1");
  assert.ok(findAll(chart, "externalData").length === 1);
  assert.match(files.get("ppt/charts/_rels/chart1.xml.rels")!.toString(), /Microsoft_Excel_Worksheet1\.xlsx/);
  const workbook = readXlsx(files.get("ppt/embeddings/Microsoft_Excel_Worksheet1.xlsx")!).model.sheets[0];
  assert.equal(workbook.cells.B1.v, "Ahorn");
  assert.equal(workbook.cells.A2.v, "Jan");
  assert.equal(workbook.cells.C4.v, "16.5");
  assert.match(files.get("[Content_Types].xml")!.toString(), /drawingml\.chart\+xml/);
  assert.deepEqual(readPptx(bytes).model, cleanModel("deck", model));
});

test("PowerPoint: fremde Datei mit Textfeld, Form, Linie, Tabelle und Diagramm wird gelesen", () => {
  const { model, imported } = readPptx(foreign(buildPptx(objectsDeck(), meta)));
  assert.equal(imported, true);
  const [slide] = model.slides;
  assert.equal(slide.title, "Kennzahlen");
  const items = slide.items;
  assert.deepEqual(
    items.map((item) => item.type),
    ["text", "shape", "shape", "table", "chart"],
  );
  const [text, shape, line, table, chart] = items;
  assert.equal(text.type === "text" && text.body.content?.[0].content?.[0].text, "Freies Textfeld");
  assert.deepEqual(
    shape.type === "shape" && { shape: shape.shape, fill: shape.fill, text: shape.text, x: shape.x, w: shape.w },
    { shape: "roundRect", fill: "#2563eb", text: "Wichtig", x: 4_572_000, w: 2_286_000 },
  );
  assert.deepEqual(line.type === "shape" && [line.shape, line.line], ["line", "#be185d"]);
  assert.deepEqual(table.type === "table" && [table.header, table.rows[2]], [true, ["Linde", "18"]]);
  assert.deepEqual(
    chart.type === "chart" && {
      chart: chart.chart,
      title: chart.title,
      categories: chart.categories,
      series: chart.series,
    },
    {
      chart: "column",
      title: "Belegung",
      categories: ["Jan", "Feb", "Mär"],
      series: [
        { name: "Ahorn", values: [22, 23, 24] },
        { name: "Linde", values: [17, 18, 16.5] },
      ],
    },
  );
});

test("Präsentation: Objekte vom Browser werden geprüft (Grenzen, Farben, unbekannte Arten)", () => {
  const deck = cleanModel("deck", {
    slides: [
      {
        items: [
          { type: "shape", shape: "star", x: -5, y: 99_999_999, w: 50_000_000, h: 10, fill: "red", line: "#ABCDEF" },
          { type: "table", rows: [["a"], ["b", "c"]] },
          { type: "script", x: 0 },
          { type: "chart", chart: "radar", categories: ["x", "y"], series: [{ name: "n", values: [1, "2"] }] },
        ],
      },
    ],
  }) as DeckModel;
  const [shape, table, chart] = deck.slides[0].items;
  assert.equal(deck.slides[0].items.length, 3);
  assert.deepEqual(
    shape.type === "shape" && [shape.shape, shape.x, shape.y, shape.w, shape.h, shape.fill, shape.line],
    ["rect", 0, 6_858_000, 12_192_000, 0, "", "#abcdef"],
  );
  assert.deepEqual(table.type === "table" && table.rows, [
    ["a", ""],
    ["b", "c"],
  ]);
  assert.deepEqual(chart.type === "chart" && [chart.chart, chart.series[0].values], ["column", [1, 0]]);
});

test("Prüfen: fremde Daten vom Browser werden bereinigt (Skript-Links, fremde Bilder, unbekannte Knoten)", () => {
  const dirty = cleanModel("document", {
    content: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
        },
        { type: "image", attrs: { src: "https://example.org/a.png" } },
        { type: "script", content: [] },
      ],
    },
  }) as DocumentModel;
  assert.deepEqual(dirty.content.content, [{ type: "paragraph", content: [{ type: "text", text: "x" }] }]);
  const sheet = cleanModel("sheet", {
    sheets: [{ name: "a/b:c", cells: { A1: { v: "1", s: { color: "red", b: true } }, ZZZZ1: { v: "x" } } }],
  }) as SheetModel;
  assert.equal(sheet.sheets[0].name, "abc");
  assert.deepEqual(sheet.sheets[0].cells, { A1: { v: "1", s: { b: true } } });
  const deck = cleanModel("deck", {
    slides: [{ layout: "evil", body: { type: "bulletList", content: [] } }],
  }) as DeckModel;
  assert.equal(deck.slides[0].layout, "content");
  assert.equal(deck.slides[0].body.type, "doc");
});

test("Tabelle bearbeiten: Zeilen einfügen/löschen passt Formeln an, Sortieren, Zwischenablage", () => {
  const sheet = newSheet("Tabelle1");
  sheet.cells.A1 = { v: "3" };
  sheet.cells.A2 = { v: "1" };
  sheet.cells.A3 = { v: "2" };
  sheet.cells.A5 = { v: "=SUMME(A1:A3)" };
  const other = newSheet("Bericht");
  other.cells.A1 = { v: "=Tabelle1!A5" };
  let model: SheetModel = { kind: "sheet", sheets: [sheet, other] };
  model = insertDelete(model, 0, "row", 1, 2);
  assert.equal(model.sheets[0].cells.A7.v, "=SUMME(A1:A5)");
  assert.equal(model.sheets[0].cells.A4.v, "1");
  assert.equal(model.sheets[1].cells.A1.v, "=Tabelle1!A7");
  model = insertDelete(model, 0, "row", 0, -1);
  assert.equal(model.sheets[0].cells.A6.v, "=SUMME(A1:A4)");
  model = renameSheet(model, 0, "Werte");
  assert.equal(model.sheets[1].cells.A1.v, "=Werte!A6");
  const sorted = sortArea(model.sheets[0], { c1: 0, r1: 2, c2: 0, r2: 3 }, 0, 1, (col, row) =>
    Number(model.sheets[0].cells[`A${row + 1}`]?.v ?? NaN),
  );
  assert.equal(sorted.cells.A3.v, "1");
  assert.equal(sorted.cells.A4.v, "2");
  assert.deepEqual(parseClipboard('a\t"b\tc"\n1\t2\n'), [
    ["a", "b\tc"],
    ["1", "2"],
  ]);
  assert.equal(toDelimited([["a;b", "x"]], ";"), '"a;b";x');
});

test("Dokumentknoten: Text für Vorschau und Suche", () => {
  const doc: DocNode = {
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "A" }] },
      { type: "paragraph", content: [{ type: "text", text: "B" }] },
    ],
  };
  assert.equal(plainText(doc), "A\nB");
});
