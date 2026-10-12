import { test } from "node:test";
import assert from "node:assert/strict";
import { inflateRawSync } from "node:zlib";
import { ApiError } from "@/lib/api-context";
import type { CarecoreActor } from "@/lib/server-data";
import {
  copyFile,
  createDocument,
  createFolder,
  folderTree,
  listVersions,
  listing,
  purgeFile,
  purgeFolder,
  readText,
  restoreVersion,
  saveText,
  updateFile,
  updateFolder,
  uploadFile,
  versionContent,
  zipSelection,
} from "@/lib/shared-files";
import { readableFile } from "@/lib/file-access";
import { apiContextFor, fixture, q } from "../support/db";

// Archiv über das zentrale Verzeichnis lesen (wie ein Entpackprogramm).
function readZip(zip: Buffer) {
  const end = zip.length - 22;
  let position = zip.readUInt32LE(end + 16);
  const files = new Map<string, string>();
  for (let index = 0; index < zip.readUInt16LE(end + 10); index += 1) {
    const nameLength = zip.readUInt16LE(position + 28);
    const local = zip.readUInt32LE(position + 42);
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + zip.readUInt32LE(position + 20));
    const name = zip.subarray(position + 46, position + 46 + nameLength).toString("utf8");
    files.set(name, (zip.readUInt16LE(position + 10) === 8 ? inflateRawSync(data) : data).toString("utf8"));
    position += 46 + nameLength;
  }
  return files;
}

const actorOf = async (f: Awaited<ReturnType<typeof fixture>>, person: string) =>
  (await apiContextFor(f, person)).actor as unknown as CarecoreActor;

const status = (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

function form(name: string, content: string, fields: Record<string, string> = {}) {
  const data = new FormData();
  data.set("file", new File([content], name, { type: name.endsWith(".pdf") ? "application/pdf" : "text/plain" }));
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

async function upload(actor: CarecoreActor, name: string, content: string, fields: Record<string, string>) {
  const result = await uploadFile(actor, form(name, content, fields));
  assert.ok("file" in result, `Upload von ${name} erwartet`);
  return result.file;
}

test("Ablage: Ordner in Ordnern, Hochladen mit Konflikt, Versionen und Textbearbeitung", async () => {
  const f = await fixture();
  const anna = await actorOf(f, "anna");
  const max = await actorOf(f, "max");
  const lead = await actorOf(f, "leadA");

  // Alle Mitarbeitenden legen Ordner an; gleicher Name im selben Ordner nicht, in einem anderen schon.
  const pflege = await createFolder(anna, { scope: "shared", name: "Pflege" });
  const hygiene = await createFolder(anna, { scope: "shared", name: "Hygiene", parentId: pflege });
  assert.equal(await status(createFolder(max, { scope: "shared", name: "pflege" })), 409);
  await createFolder(max, { scope: "shared", name: "Hygiene" });
  const tree = await folderTree(max, "shared");
  assert.deepEqual(
    tree.map((folder) => folder.name),
    ["Hygiene", "Hygiene", "Pflege"],
  );

  const file = await upload(anna, "Händehygiene.txt", "Version eins", { scope: "shared", folderId: hygiene });
  assert.equal(file.path, "Gemeinsame Ablage / Pflege / Hygiene");
  const inside = await listing(max, "shared", { folderId: hygiene });
  assert.deepEqual(
    inside.path.map((crumb) => crumb.name),
    ["Gemeinsame Ablage", "Pflege", "Hygiene"],
  );
  assert.equal(inside.files[0].canEdit, false, "fremde Datei: nur lesen");
  assert.equal((await listing(lead, "shared", { folderId: hygiene })).files[0].canEdit, true, "Leitung darf ändern");

  // Gleicher Name: Rückfrage, dann „beide behalten“ bzw. „ersetzen“ als neue Version.
  const conflict = await uploadFile(max, form("händehygiene.txt", "von Max", { scope: "shared", folderId: hygiene }));
  assert.ok("conflict" in conflict && conflict.conflict.id === file.id);
  const kept = await upload(max, "Händehygiene.txt", "von Max", {
    scope: "shared",
    folderId: hygiene,
    conflict: "keep",
  });
  assert.equal(kept.name, "Händehygiene (2).txt");
  assert.equal(
    await status(
      uploadFile(max, form("Händehygiene.txt", "x", { scope: "shared", folderId: hygiene, conflict: "replace" })),
    ),
    403,
    "ersetzen nur mit Recht auf die Datei",
  );
  const replaced = await upload(anna, "Händehygiene.txt", "Version zwei", {
    scope: "shared",
    folderId: hygiene,
    conflict: "replace",
  });
  assert.equal(replaced.id, file.id);
  assert.equal(replaced.versionNo, 2);

  // Text bearbeiten: neue Version; veraltete Version wird abgewiesen.
  const opened = await readText(anna, file.id);
  assert.equal(opened.content, "Version zwei");
  assert.equal(opened.canEdit, true);
  await saveText(anna, file.id, { content: "Version drei", versionNo: 2 });
  assert.equal(await status(saveText(anna, file.id, { content: "verloren?", versionNo: 2 })), 409);
  assert.equal(await status(saveText(max, file.id, { content: "fremd", versionNo: 3 })), 403);
  const versions = await listVersions(max, file.id);
  assert.deepEqual(
    versions.map((version) => version.versionNo),
    [3, 2, 1],
  );
  const first = versions.find((version) => version.versionNo === 1)!;
  assert.equal((await versionContent(max, file.id, first.id)).content.toString(), "Version eins");
  const restored = await restoreVersion(anna, file.id, first.id);
  assert.equal(restored.versionNo, 4);
  assert.equal((await readText(max, file.id)).content, "Version eins");

  // Neue Dokumente: Endung wird ergänzt, Name im Ordner eindeutig.
  const note = await createDocument(anna, { scope: "shared", folderId: pflege, kind: "note", name: "Teamsitzung" });
  assert.equal(note.name, "Teamsitzung.md");
  assert.equal(note.mimeType, "text/markdown");
  assert.equal(
    await status(createDocument(anna, { scope: "shared", folderId: pflege, kind: "note", name: "Teamsitzung" })),
    409,
  );

  // Kopieren und Verschieben (gleiche Namen am Ziel erhalten eine Nummer).
  const copy = await copyFile(max, file.id, { folderId: pflege });
  assert.equal(copy.name, "Händehygiene.txt");
  assert.equal(copy.canEdit, true, "Kopie gehört der Person, die kopiert hat");
  const moved = await updateFile(max, copy.id, { folderId: hygiene });
  assert.equal(moved?.name, "Händehygiene (3).txt");
  assert.equal(
    await status(updateFolder(anna, pflege, { parentId: hygiene })),
    400,
    "nicht in sich selbst verschieben",
  );

  // Audit der gemeinsamen Ablage.
  const actions = await q<{ entity_type: string; action: string }>(
    `SELECT entity_type, action FROM carecore_audit_log WHERE organization_id = $1 ORDER BY created_at`,
    [f.org],
  );
  const logged = new Set(actions.map((row) => `${row.entity_type}:${row.action}`));
  for (const pair of [
    "shared_folder:created",
    "shared_file:uploaded",
    "shared_file:versioned",
    "shared_file:copied",
    "shared_file:moved",
    "shared_file:version_restored",
  ])
    assert.ok(logged.has(pair), pair);
});

test("Ablage: Papierkorb mit Wiederherstellen, endgültig löschen, ZIP und persönliche Dateien", async () => {
  const f = await fixture();
  const anna = await actorOf(f, "anna");
  const max = await actorOf(f, "max");
  const lead = await actorOf(f, "leadA");
  const plans = await createFolder(anna, { scope: "shared", name: "Pläne" });
  const sub = await createFolder(anna, { scope: "shared", name: "2026", parentId: plans });
  const january = await upload(anna, "Januar.txt", "Dienstplan Januar", { scope: "shared", folderId: sub });
  await upload(max, "Notiz.txt", "von Max", { scope: "shared", folderId: plans });

  // ZIP behält die Ordnerstruktur.
  const zip = await zipSelection(max, "shared", [], [plans]);
  assert.equal(zip.name, "Pläne.zip");
  const entries = readZip(zip.content);
  assert.deepEqual([...entries.keys()].sort(), ["Pläne/2026/Januar.txt", "Pläne/Notiz.txt"]);
  assert.equal(entries.get("Pläne/2026/Januar.txt"), "Dienstplan Januar");

  // Ordner löschen: samt Inhalt in den Papierkorb; Datei ist nicht mehr lesbar, aber wiederherstellbar.
  assert.equal(await status(updateFolder(max, plans, { action: "trash" })), 403, "fremder Ordner");
  await updateFolder(anna, plans, { action: "trash" });
  assert.equal((await listing(max, "shared", {})).folders.length, 0);
  assert.equal(await readableFile(max, january.id), null);
  const trashForMax = await listing(max, "shared", { view: "trash" });
  assert.equal(trashForMax.folders.length, 0, "Papierkorb zeigt nur, was man selbst anlegte oder löschte");
  const trash = await listing(anna, "shared", { view: "trash" });
  assert.deepEqual(
    trash.folders.map((folder) => folder.name),
    ["Pläne"],
  );
  assert.equal(trash.files.length, 0, "Inhalt gelöschter Ordner erscheint nicht einzeln");
  await updateFolder(anna, plans, { action: "restore" });
  assert.ok(await readableFile(max, january.id));
  assert.equal((await listing(max, "shared", { folderId: sub })).files[0].name, "Januar.txt");

  // Datei löschen und endgültig entfernen (nur aus dem Papierkorb).
  assert.equal(await status(purgeFile(anna, january.id)), 409);
  await updateFile(anna, january.id, { action: "trash" });
  await purgeFile(anna, january.id);
  assert.equal((await q(`SELECT id FROM carecore_cloud_files WHERE id = $1`, [january.id])).length, 0);
  await updateFolder(lead, plans, { action: "trash" });
  await purgeFolder(lead, plans);
  assert.equal(
    (await q(`SELECT id FROM carecore_cloud_files WHERE organization_id = $1 AND purpose = 'shared'`, [f.org])).length,
    0,
  );

  // Persönliche Ordner: nur für die Person; mit dem Haus teilen verschiebt in die gemeinsame Ablage.
  const own = await createFolder(anna, { scope: "personal", name: "Fortbildung" });
  const cert = await upload(anna, "Zertifikat.txt", "bestanden", { scope: "personal", folderId: own });
  assert.equal((await listing(max, "personal", {})).folders.length, 0);
  assert.equal(await status(updateFile(max, cert.id, { name: "x.txt" })), 404);
  assert.equal(await readableFile(max, cert.id), null);
  const shared = await updateFile(anna, cert.id, { share: true });
  assert.equal(shared?.path, "Gemeinsame Ablage");
  assert.ok(await readableFile(max, cert.id));

  // Abgelaufener Papierkorb wird beim nächsten Öffnen geleert.
  await updateFile(anna, cert.id, { action: "trash" });
  await q(`UPDATE carecore_cloud_files SET deleted_at = NOW() - INTERVAL '31 days' WHERE id = $1`, [cert.id]);
  await listing(anna, "shared", {});
  assert.equal((await q(`SELECT id FROM carecore_cloud_files WHERE id = $1`, [cert.id])).length, 0);
});
