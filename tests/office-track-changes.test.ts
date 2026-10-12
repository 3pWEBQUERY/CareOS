import { test } from "node:test";
import assert from "node:assert/strict";
import { createZip, readZip } from "@/lib/zip";
import { buildDocx, readDocx } from "@/lib/office/docx";
import { mergeModels } from "@/lib/office/merge";
import { cleanModel, DEFAULT_PAGE, type DocumentModel } from "@/lib/office/model";
import { findAll, parseXml, textOf } from "@/lib/office/xml";

const meta = { title: "Test", author: "Pflege Team" };
const foreign = (bytes: Buffer) => {
  const files = readZip(bytes);
  files.delete("carecore/model.json");
  return createZip([...files].map(([path, content]) => ({ path, content })));
};
const xml = (bytes: Buffer, part: string) => parseXml(readZip(bytes).get(part)!.toString("utf8"));
const change = (type: string, author: string) => ({
  type,
  attrs: { author, date: "2026-10-05T08:30:00.000Z" },
});

const tracked = (): DocumentModel => ({
  kind: "document",
  page: { ...DEFAULT_PAGE },
  track: true,
  content: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "Dosis " },
          { type: "text", text: "5 mg", marks: [change("deletion", "Anna Muster")] },
          { type: "text", text: "2,5 mg", marks: [{ type: "bold" }, change("insertion", "Beat Huber")] },
          { type: "text", text: " täglich." },
        ],
      },
    ],
  },
});

test("Word: nachverfolgte Änderungen als <w:ins>/<w:del> mit Name und Zeit, Einstellung in settings.xml", () => {
  const model = tracked();
  const bytes = buildDocx(model, meta);
  const document = xml(bytes, "word/document.xml");
  const [del] = findAll(document, "del");
  const [ins] = findAll(document, "ins");
  assert.equal(del.attrs.author, "Anna Muster");
  assert.equal(del.attrs.date, "2026-10-05T08:30:00Z");
  assert.equal(findAll(del, "delText").map(textOf).join(""), "5 mg");
  assert.equal(findAll(del, "t").length, 0);
  assert.equal(ins.attrs.author, "Beat Huber");
  assert.equal(findAll(ins, "t").map(textOf).join(""), "2,5 mg");
  assert.notEqual(del.attrs.id, ins.attrs.id);
  assert.equal(findAll(xml(bytes, "word/settings.xml"), "trackRevisions").length, 1);
  assert.deepEqual(readDocx(bytes).model, cleanModel("document", model));

  // Aus Word gelesen (ohne gespeichertes Modell): Änderungen und Einstellung bleiben erhalten.
  const imported = readDocx(foreign(bytes)).model;
  assert.equal(imported.track, true);
  const nodes = imported.content.content?.[0].content ?? [];
  assert.deepEqual(
    nodes.map((node) => [node.text, (node.marks ?? []).map((mark) => `${mark.type}:${mark.attrs?.author ?? ""}`)]),
    [
      ["Dosis ", []],
      ["5 mg", ["deletion:Anna Muster"]],
      ["2,5 mg", ["bold:", "insertion:Beat Huber"]],
      [" täglich.", []],
    ],
  );
});

test("Word: ohne Nachverfolgen keine Einstellung, ungültige Werte werden verworfen", () => {
  const plain: DocumentModel = { ...tracked(), track: undefined };
  const bytes = buildDocx(plain, meta);
  assert.equal(findAll(xml(bytes, "word/settings.xml"), "trackRevisions").length, 0);
  assert.equal(readDocx(foreign(bytes)).model.track, undefined);
  assert.equal(cleanModel("document", { ...plain, track: "ja" }).kind, "document");
  assert.equal((cleanModel("document", { ...plain, track: "ja" }) as DocumentModel).track, undefined);
});

test("Zusammenführen: Einschalten des Nachverfolgens durch eine Person bleibt erhalten", () => {
  const base: DocumentModel = { ...tracked(), track: undefined };
  const mine: DocumentModel = { ...base, track: true };
  const theirs: DocumentModel = { ...base, page: { ...base.page, header: "Pflegebericht" } };
  const merged = mergeModels(base, mine, theirs) as DocumentModel;
  assert.equal(merged.track, true);
  assert.equal(merged.page.header, "Pflegebericht");
  const off = mergeModels(mine, { ...mine, track: undefined }, mine) as DocumentModel;
  assert.equal(off.track, undefined);
});
