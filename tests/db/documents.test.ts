import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { createDocument, documentAction, listDocuments, newVersion } from "@/lib/documents";
import { uploadResidentFile } from "@/lib/resident-record";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: "" }),
    (error) => ({
      status: error instanceof ApiError ? error.status : 500,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

const quality = (ctx: ApiContext): ApiContext => ({
  ...ctx,
  actor: { ...ctx.actor, permissions: [...ctx.actor.permissions, "quality.manage"] },
});

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  data.set("file", new File([new TextEncoder().encode("%PDF-1.4\n")], "standard.pdf", { type: "application/pdf" }));
  return data;
};

const activeVersions = (title: string) =>
  q<{ version_no: number }>(
    `SELECT version_no FROM carecore_documents WHERE title = $1 AND status = 'active' ORDER BY version_no`,
    [title],
  ).then((rows) => rows.map((row) => row.version_no));

test("Standards: je Dokument nur eine Folgeversion, nie zwei gültige Fassungen", async () => {
  const f = await fixture();
  const lead = quality(await apiContextFor(f, "leadA"));
  const title = `Sturzprophylaxe ${f.org.slice(0, 6)}`;
  assert.equal(
    (
      await failure(
        createDocument(await apiContextFor(f, "anna"), form({ kind: "standard", title, category: "Pflegestandard" })),
      )
    ).status,
    403,
    "Standards veröffentlicht das Qualitätsmanagement",
  );
  // Der Inhalt muss zum Dateityp passen: eine HTML-Seite als „PDF“ wird abgelehnt.
  const disguised = new FormData();
  disguised.set("kind", "standard");
  disguised.set("title", title);
  disguised.set("category", "Pflegestandard");
  disguised.set("file", new File(["<html><script>alert(1)</script>"], "standard.pdf", { type: "application/pdf" }));
  assert.equal((await failure(createDocument(lead, disguised))).status, 415);
  const v1 = await createDocument(
    lead,
    form({ kind: "standard", title, category: "Pflegestandard", requiresAck: "true" }),
  );
  const [notified] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_notifications WHERE type = 'standard' AND link_url LIKE $1`,
    [`%${v1}`],
  );
  assert.equal(notified.n, 6, "alle anderen aktiven Personen der Organisation");

  const v2 = await newVersion(lead, v1, form({ changeNote: "Neue Skala", status: "draft" }));
  assert.equal((await failure(newVersion(lead, v1, form({ changeNote: "Nochmals", status: "draft" })))).status, 409);
  await documentAction(lead, v2, { action: "publish" });
  assert.deepEqual(await activeVersions(title), [2]);
  // Ersetzte Fassungen bleiben unverändert.
  assert.equal(
    (await failure(documentAction(lead, v1, { action: "update", title: "Geändert", category: "Hygiene" }))).status,
    409,
  );

  // Lesen & bestätigen: einmal protokolliert, auch bei wiederholtem Klick.
  const anna = await apiContextFor(f, "anna");
  await documentAction(anna, v2, { action: "ack" });
  await documentAction(anna, v2, { action: "ack" });
  const [acks] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_audit_log WHERE entity_id = $1 AND action = 'acknowledged'`,
    [v2],
  );
  assert.equal(acks.n, 1);
  const standard = (await listDocuments(anna, new URLSearchParams({ kind: "standard" }))).documents.find(
    (doc) => doc.id === v2,
  );
  assert.ok(standard?.acknowledgedAt);

  assert.match((await failure(documentAction(lead, v2, { action: "archive" }))).message, /Grund/);
  await documentAction(lead, v2, { action: "archive", reason: "Durch Weisung ersetzt" });
  assert.deepEqual(await activeVersions(title), []);
  const other = quality(await apiContextFor(await fixture(), "leadA"));
  assert.equal((await failure(documentAction(other, v2, { action: "read" }))).status, 404);
});

test("Standards: neue Version fordert die Lesebestätigung erneut an", async () => {
  const f = await fixture();
  const lead = quality(await apiContextFor(f, "leadA"));
  const anna = await apiContextFor(f, "anna");
  const title = `Händehygiene ${f.org.slice(0, 6)}`;
  const standards = async () => (await listDocuments(anna, new URLSearchParams({ kind: "standard" }))).documents;
  const notes = (id: string) =>
    q<{ user_id: string; title: string }>(
      `SELECT user_id, title FROM carecore_notifications WHERE type = 'standard' AND link_url LIKE $1`,
      [`%${id}`],
    );

  const v1 = await createDocument(
    lead,
    form({ kind: "standard", title, category: "Pflegestandard", requiresAck: "true" }),
  );
  await documentAction(anna, v1, { action: "ack" });
  assert.ok((await standards()).find((doc) => doc.id === v1)?.acknowledgedAt);

  const v2 = await newVersion(lead, v1, form({ changeNote: "Neue Einwirkzeit" }));
  const current = (await standards()).find((doc) => doc.id === v2);
  assert.equal(current?.requiresAck, true);
  assert.equal(current?.acknowledgedAt, null, "Bestätigung der alten Fassung gilt nicht für die neue");
  assert.ok(
    (await notes(v2)).some((n) => n.user_id === f.people.anna && n.title === `Standard aktualisiert: ${title}`),
  );

  // Nachträglich verlangte Bestätigung: nur wer noch nicht bestätigt hat, wird erinnert.
  const plain = await createDocument(lead, form({ kind: "standard", title: `${title} B`, category: "Pflegestandard" }));
  assert.equal((await notes(plain)).length, 0);
  await documentAction(anna, plain, { action: "read" });
  const meta = { title: `${title} B`, category: "Pflegestandard" };
  await documentAction(lead, plain, { action: "update", ...meta, requiresAck: true });
  const requested = await notes(plain);
  assert.equal(requested.length, 6);
  assert.ok(requested.every((n) => n.title === `Bestätigung nötig: ${title} B`));
  // Erneutes Speichern ohne Änderung der Bestätigungspflicht benachrichtigt nicht noch einmal.
  await documentAction(lead, plain, { action: "update", ...meta, requiresAck: true });
  assert.equal((await notes(plain)).length, 6);
});

test("Bewohnerakte: nur PDFs und Bilder, keine Office-Dateien", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const upload = (name: string, type: string, bytes: Uint8Array<ArrayBuffer>) => {
    const data = new FormData();
    data.set("title", "Arztbericht Kardiologie");
    data.set("category", "Arztberichte");
    data.set("file", new File([bytes], name, { type }));
    return uploadResidentFile(ctx, residentId, data);
  };
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const docx = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0]);
  await upload("bericht.pdf", "application/pdf", new TextEncoder().encode("%PDF-1.4\n"));
  await upload("bericht.png", "image/png", png);
  const word = await failure(
    upload("bericht.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", docx),
  );
  assert.equal(word.status, 415);
  const [row] = await q<{ count: string }>(`SELECT COUNT(*) AS count FROM carecore_documents WHERE resident_id = $1`, [
    residentId,
  ]);
  assert.equal(Number(row.count), 2);
});
