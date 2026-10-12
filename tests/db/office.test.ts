import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError } from "@/lib/api-context";
import type { CarecoreActor } from "@/lib/server-data";
import {
  createDocument,
  listVersions,
  officeLive,
  officeLiveStream,
  readOffice,
  saveOffice,
  uploadFile,
} from "@/lib/shared-files";
import { readableFile } from "@/lib/file-access";
import { createZip, readZip } from "@/lib/zip";
import { buildDocx } from "@/lib/office/docx";
import { readXlsx } from "@/lib/office/xlsx";
import { templateModel, type DocumentModel, type SheetModel } from "@/lib/office/model";
import { apiContextFor, fixture, q } from "../support/db";

const actorOf = async (f: Awaited<ReturnType<typeof fixture>>, person: string) =>
  (await apiContextFor(f, person)).actor as unknown as CarecoreActor;

const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

test("Office in der Ablage: aus Vorlage anlegen, öffnen, automatisch speichern, Versionen und Konflikte", async () => {
  const f = await fixture();
  const anna = await actorOf(f, "anna");
  const max = await actorOf(f, "max");
  const lead = await actorOf(f, "leadA");

  // Aus der Vorlage „Bestellliste“: echte .xlsx-Datei; ohne eigenen Namen wird ein freier Name gewählt.
  const file = await createDocument(anna, { action: "document", scope: "shared", template: "sheet-order" });
  assert.equal(file.name, "Bestellliste.xlsx");
  assert.equal(file.mimeType, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const second = await createDocument(anna, { action: "document", scope: "shared", template: "sheet-order" });
  assert.equal(second.name, "Bestellliste (2).xlsx");
  const named = await createDocument(anna, {
    action: "document",
    scope: "shared",
    template: "document-minutes",
    name: "Sitzung Mai",
  });
  assert.equal(named.name, "Sitzung Mai.docx");

  const opened = await readOffice(anna, file.id);
  assert.equal(opened.kind, "sheet");
  assert.equal(opened.imported, false);
  assert.equal(opened.revision, 0);
  assert.equal(opened.canEdit, true);
  const sheet = opened.model as SheetModel;
  assert.equal(sheet.sheets[0].name, "Bestellung");
  assert.equal((await readOffice(max, file.id)).canEdit, false);

  // Automatisches Speichern derselben Person kurz nach dem Anlegen: keine neue Version.
  sheet.sheets[0].cells.A2 = { v: "Handschuhe" };
  sheet.sheets[0].cells.C2 = { v: "10" };
  sheet.sheets[0].cells.D2 = { v: "12.5", s: { fmt: "chf" } };
  const autosaved = await saveOffice(anna, file.id, { model: sheet, revision: 0, auto: true });
  assert.equal(autosaved.file.versionNo, 1);
  assert.equal(autosaved.revision, 1);
  assert.equal((await listVersions(anna, file.id)).length, 1);

  // Veralteter Stand wird abgelehnt (gleichzeitige Änderung), fremde Personen dürfen nicht speichern.
  assert.equal(await status(saveOffice(anna, file.id, { model: sheet, revision: 0, auto: true })), 409);
  assert.equal(await status(saveOffice(max, file.id, { model: sheet, revision: 1, auto: true })), 403);
  assert.equal(await status(saveOffice(anna, file.id, { model: sheet, auto: true })), 400);

  // Die Leitung speichert: andere Person → bisherige Fassung bleibt als Version erhalten.
  sheet.sheets[0].cells.A3 = { v: "Masken" };
  const byLead = await saveOffice(lead, file.id, { model: sheet, revision: 1, auto: true });
  assert.equal(byLead.file.versionNo, 2);
  // „Version speichern“ legt immer eine Version an.
  const manual = await saveOffice(lead, file.id, { model: sheet, revision: byLead.revision });
  assert.equal(manual.file.versionNo, 3);
  assert.deepEqual(
    (await listVersions(anna, file.id)).map((version) => version.versionNo),
    [3, 2, 1],
  );

  // Die gespeicherte Datei ist eine echte Arbeitsmappe mit berechneter Formel.
  const download = await readableFile(max, file.id);
  assert.ok(download);
  const workbook = readXlsx(Buffer.from(download.content)).model;
  assert.equal(workbook.sheets[0].cells.A3.v, "Masken");
  assert.match(
    readZip(Buffer.from(download.content)).get("xl/worksheets/sheet1.xml")!.toString(),
    /<f>IF\(C2=&quot;&quot;,&quot;&quot;,C2\*D2\)<\/f><v>125<\/v>/,
  );

  // Kopie der eigenen Fassung (z. B. nach einem Konflikt).
  const copy = await createDocument(max, {
    action: "document",
    scope: "shared",
    office: "sheet",
    model: sheet,
    name: "Bestellliste meine Fassung",
  });
  assert.equal(copy.name, "Bestellliste meine Fassung.xlsx");
  assert.equal(((await readOffice(max, copy.id)).model as SheetModel).sheets[0].cells.A3.v, "Masken");

  // Textdateien sind keine Office-Dokumente.
  const text = await createDocument(anna, { action: "document", scope: "shared", kind: "text", name: "Notiz" });
  assert.equal(await status(readOffice(anna, text.id)), 400);
});

test("Office in der Ablage: Word-Datei aus einem anderen Programm öffnen und bearbeiten (Original bleibt Version)", async () => {
  const f = await fixture();
  const anna = await actorOf(f, "anna");
  const model = templateModel("document-leaflet") as DocumentModel;
  // Ohne eingebettetes CareOS-Modell, wie aus Word.
  const files = readZip(buildDocx(model, { title: "Merkblatt", author: "Word" }));
  files.delete("carecore/model.json");
  const bytes = createZip([...files.entries()].map(([path, content]) => ({ path, content })));
  const form = new FormData();
  form.set(
    "file",
    new File([bytes], "Merkblatt Besuch.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    }),
  );
  form.set("scope", "personal");
  const uploaded = await uploadFile(anna, form);
  assert.ok("file" in uploaded);
  const opened = await readOffice(anna, uploaded.file.id);
  assert.equal(opened.kind, "document");
  assert.equal(opened.imported, true);
  const document = opened.model as DocumentModel;
  assert.equal(document.content.content?.[0].type, "heading");
  document.content.content?.push({ type: "paragraph", content: [{ type: "text", text: "Besuchszeiten 10–18 Uhr" }] });
  // Die erste Speicherung einer fremden Datei legt eine Version an (auto: false aus dem Editor).
  const saved = await saveOffice(anna, uploaded.file.id, { model: document, revision: opened.revision, auto: false });
  assert.equal(saved.file.versionNo, 2);
  const again = await readOffice(anna, uploaded.file.id);
  assert.equal(again.imported, false);
  assert.match(JSON.stringify(again.model), /Besuchszeiten 10–18 Uhr/);

  // Beschädigte Office-Datei: verständlicher Fehler statt Absturz.
  const broken = new FormData();
  broken.set("file", new File([Buffer.from("PK kaputt")], "Defekt.xlsx", { type: "application/octet-stream" }));
  broken.set("scope", "personal");
  const result = await uploadFile(anna, broken);
  if ("file" in result) assert.equal(await status(readOffice(anna, result.file.id)), 422);
  else assert.fail("Upload erwartet");
  await q(`SELECT 1`);
});

test("Gleichzeitiges Bearbeiten: wer ist in der Datei, wo, und neuester Stand nur bei Änderung", async () => {
  const f = await fixture();
  const anna = await actorOf(f, "anna");
  const lead = await actorOf(f, "leadA");
  const max = await actorOf(f, "max");
  const file = await createDocument(anna, { action: "document", scope: "shared", template: "sheet-order" });
  const sessionA = "annafenster01";
  const sessionL = "leitungfenster01";

  // Erstes Lebenszeichen: noch niemand sonst da, Stand unverändert → ohne Modell.
  const first = await officeLive(anna, file.id, { session: sessionA, revision: 0, place: { cell: "B2" } });
  assert.deepEqual(first.people, []);
  assert.equal(first.revision, 0);
  assert.equal("model" in first, false);

  // Die Leitung kommt dazu und speichert; Anna sieht sie, ihre Stelle und den neuen Stand.
  const opened = await readOffice(lead, file.id);
  await officeLive(lead, file.id, { session: sessionL, revision: 0, place: { sheet: "x".repeat(8), cell: "C4" } });
  const sheet = opened.model as SheetModel;
  sheet.sheets[0].cells.A2 = { v: "Handschuhe" };
  const saved = await saveOffice(lead, file.id, { model: sheet, revision: 0, auto: true });
  const seen = await officeLive(anna, file.id, { session: sessionA, revision: 0, place: { cell: "B2" } });
  assert.equal(seen.revision, saved.revision);
  assert.deepEqual(
    seen.people.map((person) => [person.name.length > 0, person.self, person.place]),
    [[true, false, { sheet: "xxxxxxxx", cell: "C4" }]],
  );
  assert.equal((seen as { model?: SheetModel }).model?.sheets[0].cells.A2.v, "Handschuhe");
  // Ungültige Stellen werden verworfen, nicht gespeichert.
  await officeLive(lead, file.id, { session: sessionL, revision: saved.revision, place: { cell: "<b>", block: -1 } });
  const cleaned = await officeLive(anna, file.id, { session: sessionA, revision: saved.revision });
  assert.equal(cleaned.people[0].place, null);

  // Laufende Verbindung: Stand und Personen ohne Inhalt, mit derselben Zugriffsprüfung.
  const stream = await officeLiveStream(anna, file.id, sessionA);
  const streamed = await stream();
  assert.equal(streamed.revision, saved.revision);
  assert.deepEqual(
    streamed.people.map((person) => person.session),
    [sessionL],
  );
  assert.equal("model" in streamed, false);
  assert.equal(await status(officeLiveStream(anna, file.id, "x")), 400);

  // Verlassen: nicht mehr in der Liste. Ohne Sitzung oder ohne Zugriff kein Lebenszeichen.
  await officeLive(lead, file.id, { session: sessionL, leave: true });
  assert.deepEqual((await officeLive(anna, file.id, { session: sessionA, revision: saved.revision })).people, []);
  assert.equal(await status(officeLive(anna, file.id, { session: "x", revision: 0 })), 400);
  const own = await createDocument(anna, { action: "document", scope: "personal", template: "sheet-order" });
  assert.equal(await status(officeLive(max, own.id, { session: "maxfenster01", revision: 0 })), 404);
  assert.equal(await status(officeLiveStream(max, own.id, "maxfenster01")), 404);
  assert.equal(await status(officeLiveStream(max, "keine-kennung", "maxfenster01")), 404);
});
