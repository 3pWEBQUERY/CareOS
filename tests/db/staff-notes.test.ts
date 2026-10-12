import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { carecoreDb } from "@/lib/server-data";
import { createNote, deleteNote, listNotes, updateNote } from "@/lib/staff-notes";
import { fixture, q } from "../support/db";

const status = async (promise: Promise<unknown>) =>
  promise.then(
    () => 200,
    (error) => (error instanceof ApiError ? error.status : 500),
  );

test("Persönliche Notizen: archivieren, wiederherstellen, nur eigene, wiederholbar für den Offline-Betrieb", async () => {
  const f = await fixture();
  const sql = carecoreDb();
  const anna = { sql, userId: f.people.anna, organizationId: f.org };
  const max = { sql, userId: f.people.max, organizationId: f.org };
  const id = randomUUID();

  // Offline erfasst und zweimal gesendet: nur eine Notiz.
  await createNote(anna, { id, title: "Übergabe", body: "Frau Keller Blutzucker nachkontrollieren", pinned: true });
  await createNote(anna, { id, title: "Übergabe", body: "Frau Keller Blutzucker nachkontrollieren", pinned: true });
  assert.equal((await listNotes(anna)).length, 1);
  assert.equal(await status(createNote(max, { id, title: "Fremd", body: "x" })), 409, "fremde Kennung");
  assert.equal(await status(createNote(anna, { id: "abc", title: "x", body: "y" })), 400);
  assert.equal(await status(createNote(anna, { id: randomUUID(), title: "", body: "y" })), 400);

  // Archivieren ändert den Inhalt nicht und ist wiederholbar; der Zeitpunkt bleibt der erste.
  const archived = await updateNote(anna, { id, archived: true });
  assert.ok(archived.archived_at);
  const again = await updateNote(anna, { id, archived: true });
  assert.equal(again.archived_at, archived.archived_at);
  assert.equal(again.body, "Frau Keller Blutzucker nachkontrollieren");
  const second = randomUUID();
  await createNote(anna, { id: second, title: "Schulung", body: "Kinästhetik am Freitag" });
  const listed = await listNotes(anna);
  assert.deepEqual(
    listed.map((note) => [note.title, note.archived_at !== null]),
    [
      ["Schulung", false],
      ["Übergabe", true],
    ],
  );

  // Wiederherstellen und bearbeiten.
  assert.equal((await updateNote(anna, { id, archived: false })).archived_at, null);
  const edited = await updateNote(anna, { id, title: "Übergabe Spätdienst", body: "BZ um 17 Uhr", pinned: false });
  assert.equal(edited.title, "Übergabe Spätdienst");
  assert.equal(await status(updateNote(anna, { id })), 400, "keine Änderung");
  assert.equal(await status(updateNote(anna, { id, archived: "ja" })), 400);

  // Andere sehen und ändern die Notizen nicht.
  assert.equal((await listNotes(max)).length, 0);
  assert.equal(await status(updateNote(max, { id, archived: true })), 404);
  await deleteNote(max, { id });
  assert.equal((await listNotes(anna)).length, 2, "fremdes Löschen wirkt nicht");

  // Löschen ist wiederholbar.
  await deleteNote(anna, { id });
  await deleteNote(anna, { id });
  assert.deepEqual(
    (await listNotes(anna)).map((note) => note.id),
    [second],
  );
});

test("Persönliche Notizen: Bearbeitung auf veraltetem Stand meldet einen Konflikt", async () => {
  const f = await fixture();
  const anna = { sql: carecoreDb(), userId: f.people.anna, organizationId: f.org };
  const id = randomUUID();
  const created = await createNote(anna, { id, title: "Einkauf", body: "Handschuhe", pinned: false });
  // Gerät A ändert die Notiz auf dem geladenen Stand.
  const first = await updateNote(anna, {
    id,
    title: "Einkauf",
    body: "Handschuhe M",
    pinned: false,
    baseUpdatedAt: created.updated_at,
  });
  // Gerät B schickt später eine Änderung auf demselben, inzwischen veralteten Stand.
  assert.equal(
    await status(
      updateNote(anna, {
        id,
        title: "Einkauf",
        body: "Handschuhe L",
        pinned: false,
        baseUpdatedAt: created.updated_at,
      }),
    ),
    409,
  );
  // Auf dem aktuellen Stand – oder ausdrücklich ohne Vergleich („Meine Fassung übernehmen“) – geht es.
  await updateNote(anna, {
    id,
    title: "Einkauf",
    body: "Handschuhe S",
    pinned: false,
    baseUpdatedAt: first.updated_at,
  });
  const forced = await updateNote(anna, { id, title: "Einkauf", body: "Handschuhe L", pinned: false });
  assert.equal(forced.body, "Handschuhe L");
  // Nur archivieren braucht keinen Vergleich; eine fremde oder fehlende Notiz bleibt „nicht gefunden“.
  assert.equal(
    await status(updateNote(anna, { id: randomUUID(), archived: true, baseUpdatedAt: created.updated_at })),
    404,
  );
});

test("Persönliche Notizen: zwei Änderungen in derselben Millisekunde – die zweite auf altem Stand ist ein Konflikt", async () => {
  const f = await fixture();
  const anna = { sql: carecoreDb(), userId: f.people.anna, organizationId: f.org };
  const id = randomUUID();
  await createNote(anna, { id, title: "Dienst", body: "Früh", pinned: false });
  // Stand liegt (wie bei schnell aufeinanderfolgenden Änderungen oder Uhrabweichung) nicht vor der Serverzeit.
  await q(`UPDATE carecore_staff_notes SET updated_at = NOW() + INTERVAL '1 hour' WHERE id = $1`, [id]);
  const loaded = (await listNotes(anna)).find((note) => note.id === id)!;
  const first = await updateNote(anna, {
    id,
    title: "Dienst",
    body: "Spät",
    pinned: false,
    baseUpdatedAt: loaded.updated_at,
  });
  assert.ok(Date.parse(first.updated_at) > Date.parse(loaded.updated_at), "jede Änderung rückt den Stand weiter");
  assert.equal(
    await status(
      updateNote(anna, { id, title: "Dienst", body: "Nacht", pinned: false, baseUpdatedAt: loaded.updated_at }),
    ),
    409,
  );
});
