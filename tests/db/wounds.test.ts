import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { hidePhoto, listPhotos, readPhoto, storePhoto } from "@/lib/wound-photos";
import {
  addEntry,
  createWound,
  createWoundReminders,
  listEntries,
  setWoundStatus,
  updateWound,
  woundsOverview,
} from "@/lib/wounds";
import { apiContextFor, createResident, fixture, q } from "../support/db";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: "" }),
    (error) => ({
      status: error instanceof ApiError ? error.status : 500,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

const isoDay = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

// Einträge im Änderungsprotokoll der Akte (wie die Karte „Änderungsprotokoll“ sie sucht).
const residentLog = (residentId: string) =>
  q<{ entity_type: string; action: string }>(
    `SELECT entity_type, action FROM carecore_audit_log
     WHERE entity_id = $1 OR COALESCE(after_data ->> 'residentId', before_data ->> 'residentId') = $1::text
     ORDER BY created_at`,
    [residentId],
  );

const wound = (residentId: string, extra: Record<string, unknown> = {}) => ({
  residentId,
  woundType: "Dekubitus",
  category: "Kategorie 2",
  bodyLocation: "Sakralbereich",
  discoveredOn: isoDay(-1),
  careIntervalDays: 2,
  origin: "inhouse",
  ...extra,
});

test("Wunde anlegen, bearbeiten, dokumentieren und abschliessen – alles im Änderungsprotokoll der Akte", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const id = await createWound(ctx, {
    ...wound(residentId),
    initialEntry: { lengthCm: 3, widthCm: 2, tissue: "Granulation" },
  });
  await updateWound(ctx, id, { ...wound(residentId), careIntervalDays: 3, treatmentPlan: "Hydrokolloid" });
  await addEntry(ctx, id, { lengthCm: 2.5, widthCm: 2, woundStatus: "healing" });
  assert.equal((await listEntries(ctx, id)).entries.length, 2);
  assert.equal((await woundsOverview(ctx, false)).wounds[0].status, "healing");

  assert.match((await failure(setWoundStatus(ctx, id, "closed", ""))).message, /Grund/);
  await setWoundStatus(ctx, id, "closed", "vollständig epithelisiert");
  assert.equal((await failure(addEntry(ctx, id, { note: "Kontrolle" }))).status, 409, "abgeschlossen");
  await setWoundStatus(ctx, id, "closed", "doppelt");
  await setWoundStatus(ctx, id, "active", "");

  assert.deepEqual(
    (await residentLog(residentId)).map((row) => `${row.entity_type}:${row.action}`),
    ["wound:created", "wound:updated", "wound_entry:documented", "wound:status_closed", "wound:status_active"],
    "gleicher Status wird nicht erneut protokolliert",
  );
});

test("Wundversorgung: Verbandsmaterial aus dem Katalog als Momentaufnahme je Versorgung", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const product = async (name: string, unit: string, status = "active", org = f.org) => {
    const id = randomUUID();
    await q(
      `INSERT INTO carecore_care_supply_products (id, organization_id, item_name, unit, category, status)
       VALUES ($1, $2, $3, $4, 'Wundversorgung', $5)`,
      [id, org, name, unit, status],
    );
    return id;
  };
  const foam = await product("Schaumverband 10×10 cm", "Stück");
  const saline = await product("NaCl 0,9 % 10 ml", "Ampulle");
  const archived = await product("Alter Verband", "Stück", "archived");
  const foreign = await product("Fremdprodukt", "Stück", "active", (await fixture()).org);

  const id = await createWound(ctx, {
    ...wound(residentId),
    initialEntry: { materials: [{ productId: foam, quantity: 1 }] },
  });
  await addEntry(ctx, id, {
    treatment: "Reinigung, Schaumverband",
    materials: [
      { productId: saline, quantity: 2 },
      { productId: foam, quantity: 1 },
    ],
  });
  for (const materials of [
    [{ productId: archived, quantity: 1 }],
    [{ productId: foreign, quantity: 1 }],
    [{ productId: foam, quantity: 0 }],
    [
      { productId: foam, quantity: 1 },
      { productId: foam, quantity: 2 },
    ],
    "Schaumverband",
  ])
    assert.ok((await failure(addEntry(ctx, id, { note: "x", materials }))).status >= 400, JSON.stringify(materials));

  // Umbenennung im Katalog ändert die Dokumentation nicht.
  await q(`UPDATE carecore_care_supply_products SET item_name = 'Umbenannt' WHERE id = $1`, [foam]);
  const [latest, initial] = (await listEntries(ctx, id)).entries;
  assert.equal(initial.entryType, "Erstbeurteilung");
  assert.deepEqual(initial.materials, [
    { productId: foam, name: "Schaumverband 10×10 cm", unit: "Stück", quantity: 1 },
  ]);
  assert.deepEqual(
    latest.materials.map((m) => `${m.quantity} ${m.unit} ${m.name}`),
    ["2 Ampulle NaCl 0,9 % 10 ml", "1 Stück Schaumverband 10×10 cm"],
  );
});

test("Überfällige Wundversorgung: Erinnerung an die Verantwortlichen, je Versorgungszyklus einmal", async () => {
  const f = await fixture();
  const writer = async (person: string) => {
    const ctx = await apiContextFor(f, person);
    return { ...ctx, actor: { ...ctx.actor, permissions: [...ctx.actor.permissions, "documentation.write"] } };
  };
  const anna = await writer("anna");
  const reminders = (person: string) =>
    q<{ title: string; body: string; link_url: string; priority: string }>(
      `SELECT title, body, link_url, priority FROM carecore_notifications WHERE user_id = $1 AND type = 'wound_overdue' ORDER BY created_at`,
      [f.people[person]],
    );
  const residentId = await createResident(f, "Hans Müller");
  // Intervall 2 Tage, festgestellt vor 3 Tagen, noch kein Verlaufseintrag: seit einem Tag überfällig.
  const id = await createWound(
    anna,
    wound(residentId, { bodyLocation: "Rechter Ellenbogen", discoveredOn: isoDay(-3) }),
  );
  const [overview] = (await woundsOverview(anna, false)).wounds;
  assert.equal(overview.overdue, true);

  // Ohne Verantwortliche: alle mit Dokumentationsrecht und diesem festen Wohnbereich, nur einmal.
  await createWoundReminders(anna);
  await createWoundReminders(anna);
  const [first] = await reminders("anna");
  assert.equal((await reminders("anna")).length, 1);
  assert.equal(first.title, "Wundversorgung überfällig: Hans Müller");
  assert.match(first.body, /^Rechter Ellenbogen · fällig seit \d{2}\.\d{2}\.\d{4} \d{2}:\d{2} Uhr\.$/);
  assert.equal(first.link_url, `/c/wundmanagement?wound=${id}`);
  assert.equal(first.priority, "high");
  await createWoundReminders(await writer("ben"));
  assert.equal((await reminders("ben")).length, 0, "anderer Wohnbereich");
  await createWoundReminders(await apiContextFor(f, "max"));
  assert.equal((await reminders("max")).length, 0, "ohne Dokumentationsrecht");

  // Mit Verantwortlicher geht die Erinnerung nur an sie.
  await q(`UPDATE carecore_wounds SET responsible_user_id = $2 WHERE id = $1`, [id, f.people.lea]);
  await createWoundReminders(await writer("max"));
  await createWoundReminders(await writer("lea"));
  assert.equal((await reminders("max")).length, 0);
  assert.equal((await reminders("lea")).length, 1);

  // Der Verlaufseintrag erledigt die Versorgung; erst der nächste überfällige Zyklus erinnert wieder.
  await addEntry(anna, id, { note: "Verband gewechselt" });
  assert.equal((await woundsOverview(anna, false)).wounds[0].overdue, false);
  await createWoundReminders(await writer("lea"));
  assert.equal((await reminders("lea")).length, 1);
  await q(`UPDATE carecore_notifications SET created_at = NOW() - INTERVAL '5 days' WHERE user_id = $1`, [
    f.people.lea,
  ]);
  await q(`UPDATE carecore_wound_entries SET observed_at = NOW() - INTERVAL '60 hours' WHERE wound_id = $1`, [id]);
  await createWoundReminders(await writer("lea"));
  assert.equal((await reminders("lea")).length, 2);
});

test("Wunde: ungültige Angaben werden abgelehnt statt stillschweigend verworfen", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  assert.match((await failure(createWound(ctx, wound(residentId, { discoveredOn: isoDay(2) })))).message, /Zukunft/);
  assert.match((await failure(createWound(ctx, wound(residentId, { careIntervalDays: 21 })))).message, /Intervall/);
  assert.match((await failure(createWound(ctx, wound(residentId, { careIntervalDays: "2" })))).message, /Intervall/);
  assert.match((await failure(createWound(ctx, wound(residentId, { category: null })))).message, /Kategorie/);

  // Verantwortlich: nur aktive Personen der eigenen Organisation.
  await q(`UPDATE carecore_users SET active = FALSE WHERE id = $1`, [f.people.max]);
  assert.match(
    (await failure(createWound(ctx, wound(residentId, { responsibleId: f.people.max })))).message,
    /nicht aktiv/,
  );
  const other = await fixture();
  assert.match(
    (await failure(createWound(ctx, wound(residentId, { responsibleId: other.people.anna })))).message,
    /Organisation/,
  );

  const id = await createWound(ctx, wound(residentId, { careIntervalDays: null }));
  assert.match(
    (await failure(updateWound(ctx, id, wound(residentId, { discoveredOn: isoDay(3) })))).message,
    /Zukunft/,
  );

  // Körpermarkierung eines anderen Bewohners lässt sich nicht verknüpfen.
  const otherResident = await createResident(f, "Otto Anders");
  const marker = randomUUID();
  await q(
    `INSERT INTO carecore_body_observations (id, resident_id, kind, label, location, body_x, body_y, body_z)
     VALUES ($1, $2, 'wound', 'Rötung', 'Ferse', 0, 0, 0)`,
    [marker, otherResident],
  );
  assert.match(
    (await failure(updateWound(ctx, id, wound(residentId, { bodyObservationId: marker })))).message,
    /Markierung/,
  );
});

test("Wunden anderer Organisationen sind nicht sichtbar", async () => {
  const f = await fixture();
  const residentId = await createResident(f);
  const id = await createWound(await apiContextFor(f, "anna"), wound(residentId));
  const other = await apiContextFor(await fixture(), "anna");
  assert.equal((await woundsOverview(other, true)).wounds.length, 0);
  assert.equal((await failure(listEntries(other, id))).status, 404);
  assert.equal((await failure(addEntry(other, id, { note: "x" }))).status, 404);
  assert.equal((await failure(setWoundStatus(other, id, "closed", "x"))).status, 404);
  assert.equal((await failure(listPhotos(other, id))).status, 404);
});

test("Wundfotos: nur echte Bilder, Ausblenden mit Grund, beides im Protokoll", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const id = await createWound(ctx, wound(residentId));
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a1f2ff6e0000000049454e44ae426082",
    "hex",
  );
  const form = (bytes: Buffer, consent = "true") => {
    const data = new FormData();
    data.set("file", new File([new Uint8Array(bytes)], "foto.png", { type: "image/png" }));
    data.set("consent", consent);
    return data;
  };
  assert.match((await failure(storePhoto(ctx, id, form(png, "false")))).message, /Einwilligung/);
  assert.match((await failure(storePhoto(ctx, id, form(Buffer.from("<svg></svg>"))))).message, /JPEG/);
  const photoId = await storePhoto(ctx, id, form(png));
  assert.equal((await readPhoto(ctx, photoId)).mimeType, "image/png");
  assert.equal((await failure(readPhoto(await apiContextFor(await fixture(), "anna"), photoId))).status, 404);

  assert.match((await failure(hidePhoto(ctx, photoId, ""))).message, /Grund/);
  await hidePhoto(ctx, photoId, "unscharf");
  assert.equal((await failure(hidePhoto(ctx, photoId, "nochmals"))).status, 404);
  assert.equal((await listPhotos(ctx, id)).length, 0);
  const log = (await residentLog(residentId)).map((row) => `${row.entity_type}:${row.action}`);
  assert.deepEqual(log.slice(-2), ["wound_photo:uploaded", "wound_photo:hidden"]);
});
