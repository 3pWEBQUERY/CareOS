import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError } from "@/lib/api-context";
import { hashPassword } from "@/lib/auth";
import { btmBook, btmOverview, countStock, createBtmReminders, setControlled } from "@/lib/medication-btm";
import { createOrder, parseOrderInput } from "@/lib/medication-orders";
import { administerPrn, documentScheduledDose } from "@/lib/medication-round";
import { localDate, zonedToUtc } from "@/lib/roster/time";
import { saveSetting } from "@/lib/settings";
import { correctStock, receiveStock } from "@/lib/medication-stock";
import { apiContextFor, createResident, fixture, q, qualify, type Fixture } from "../support/db";

const PASSWORD = "Zeugin-Test-2026";

const failure = async (promise: Promise<unknown>) =>
  promise.then(
    () => ({ status: 200, message: "" }),
    (error) => ({
      status: error instanceof ApiError ? error.status : 500,
      message: error instanceof Error ? error.message : String(error),
    }),
  );

// Zeuginnen und Zeugen melden sich mit Benutzername und Passwort an. Max (FaGe) und Lea (HF) dürfen
// Medikation; Sam (Pflegehelfer SRK) nicht.
async function withPasswords(f: Fixture) {
  await qualify(f, "max", "FAGE");
  await qualify(f, "lea", "HF");
  await qualify(f, "sam", "SRK");
  const hash = await hashPassword(PASSWORD);
  await q(`UPDATE carecore_users SET password_hash = $1 WHERE id = ANY($2::uuid[])`, [hash, Object.values(f.people)]);
  const usernames = await q<{ id: string; username: string }>(
    `SELECT id, username FROM carecore_users WHERE id = ANY($1::uuid[])`,
    [Object.values(f.people)],
  );
  const name = (person: string) => usernames.find((row) => row.id === f.people[person])!.username;
  return (person: string, password = PASSWORD) => ({ username: name(person), password });
}

// BtM-Präparat mit Stationsbestand von 10 Stück im Wohnbereich A.
async function btmStock(f: Fixture) {
  const medication = randomUUID();
  const stock = randomUUID();
  await q(
    `INSERT INTO carecore_medications (id, organization_id, name, strength, is_controlled) VALUES ($1, $2, 'Morphin', '10 mg', TRUE)`,
    [medication, f.org],
  );
  await q(
    `INSERT INTO carecore_medication_stock (id, organization_id, care_unit_id, medication_id, quantity, unit) VALUES ($1, $2, $3, $4, 10, 'Tabletten')`,
    [stock, f.org, f.units.a, medication],
  );
  return { medication, stock };
}

test("BtM-Eingang: nur mit gültiger Zweitunterschrift einer berechtigten anderen Person", async () => {
  const f = await fixture();
  const witness = await withPasswords(f);
  const ctx = await apiContextFor(f, "anna");
  const { stock } = await btmStock(f);
  const receipt = (extra: Record<string, unknown>) =>
    receiveStock(ctx, { stockId: stock, quantity: 5, note: "Lieferung", ...extra });

  assert.match((await failure(receipt({}))).message, /Zweitunterschrift/);
  assert.equal((await failure(receipt({ witness: witness("max", "falsch") }))).status, 403);
  assert.match((await failure(receipt({ witness: witness("anna") }))).message, /anderen Person/);
  // Pflege ohne berechtigende Qualifikation (Pflegehelfer SRK) zählt nicht.
  assert.match((await failure(receipt({ witness: witness("sam") }))).message, /nicht für Medikation berechtigt/);
  assert.match((await failure(receipt({ witness: witness("ben") }))).message, /nicht für Medikation berechtigt/);
  // Eine Person einer anderen Organisation zählt nicht.
  const other = await fixture();
  const otherWitness = await withPasswords(other);
  assert.match((await failure(receipt({ witness: otherWitness("max") }))).message, /Organisation/);

  // Die Leitung darf Medikation und kann bezeugen.
  await receipt({ witness: witness("leadA") });
  await receipt({ witness: witness("max") });
  const [row] = await q<{ quantity: string }>(`SELECT quantity FROM carecore_medication_stock WHERE id = $1`, [stock]);
  assert.equal(Number(row.quantity), 20);
  const book = await btmBook(ctx, stock);
  assert.equal(book.entries[0].kind, "receipt");
  assert.equal(book.entries[0].witness, "Max Meier");
  assert.equal(book.entries[0].balance, 20);
  assert.equal(book.entries[1].witness, "Laura Leitung");
  assert.equal(book.opening, 10, "Bestand vor der ersten Buchung wird als Übertrag ausgewiesen");
});

test("BtM-Bestandskontrolle: Differenz nur mit Begründung, Buchung und Kontrolle gemeinsam", async () => {
  const f = await fixture();
  const witness = await withPasswords(f);
  const ctx = await apiContextFor(f, "anna");
  const { stock } = await btmStock(f);

  // Stimmt der Bestand, entsteht nur die Kontrolle, keine Buchung.
  assert.deepEqual(await countStock(ctx, stock, { counted: 10, witness: witness("max") }), {
    difference: 0,
    witness: "Max Meier",
  });
  assert.match((await failure(countStock(ctx, stock, { counted: 9, witness: witness("max") }))).message, /begründen/);
  assert.match(
    (await failure(countStock(ctx, stock, { counted: 9, note: "Tablette zerbrochen" }))).message,
    /Zweitunterschrift/,
  );
  await countStock(ctx, stock, { counted: 9, note: "Tablette zerbrochen", witness: witness("lea") });

  const book = await btmBook(ctx, stock);
  assert.equal(book.stock.quantity, 9);
  assert.deepEqual(
    book.entries.map((entry) => [entry.kind, entry.delta, entry.balance, entry.expected, entry.counted]),
    [
      ["count", -1, 9, 10, 9],
      ["count", 0, 10, 10, 10],
    ],
  );
  const overview = await btmOverview(ctx);
  assert.equal(overview.items[0].lastCount?.counted, 9);
  assert.equal(overview.items[0].lastCount?.witness, "Lea Beispiel");
  // Nicht-BtM-Bestände werden hier nicht kontrolliert.
  const plain = randomUUID();
  const med = randomUUID();
  await q(`INSERT INTO carecore_medications (id, organization_id, name) VALUES ($1, $2, 'Paracetamol')`, [med, f.org]);
  await q(
    `INSERT INTO carecore_medication_stock (id, organization_id, care_unit_id, medication_id, quantity, unit) VALUES ($1, $2, $3, $4, 5, 'Stk.')`,
    [plain, f.org, f.units.a, med],
  );
  assert.equal((await failure(countStock(ctx, plain, { counted: 5, witness: witness("max") }))).status, 400);
});

test("BtM-Buchungen und -Kontrollen sind unveränderlich", async () => {
  const f = await fixture();
  const witness = await withPasswords(f);
  const ctx = await apiContextFor(f, "anna");
  const { stock } = await btmStock(f);
  await countStock(ctx, stock, { counted: 8, note: "Differenz bei Übergabe", witness: witness("max") });
  const [movement] = await q<{ id: string }>(`SELECT id FROM carecore_medication_stock_movements WHERE stock_id = $1`, [
    stock,
  ]);
  await assert.rejects(
    q(`UPDATE carecore_medication_stock_movements SET delta = -1 WHERE id = $1`, [movement.id]),
    /nicht geändert/,
  );
  await assert.rejects(
    q(`DELETE FROM carecore_medication_stock_movements WHERE id = $1`, [movement.id]),
    /nicht gelöscht/,
  );
  await assert.rejects(
    q(`UPDATE carecore_btm_counts SET counted_quantity = 10 WHERE stock_id = $1`, [stock]),
    /nicht geändert/,
  );
  await assert.rejects(q(`DELETE FROM carecore_btm_counts WHERE stock_id = $1`, [stock]), /nicht gelöscht/);
});

test("Korrektur und Entsorgung von BtM über die Bestände verlangen ebenfalls die Zweitunterschrift", async () => {
  const f = await fixture();
  const witness = await withPasswords(f);
  const ctx = await apiContextFor(f, "anna");
  const { stock } = await btmStock(f);
  const residentId = await createResident(f);
  assert.match(
    (await failure(correctStock(ctx, stock, { quantity: 7, reason: "disposal", note: "Verfallen" }))).message,
    /Zweitunterschrift/,
  );
  await correctStock(ctx, stock, { quantity: 7, reason: "disposal", note: "Verfallen", witness: witness("max") });
  const book = await btmBook(ctx, stock);
  assert.deepEqual(
    [book.entries[0].kind, book.entries[0].delta, book.entries[0].witness],
    ["disposal", -3, "Max Meier"],
  );
  // Neuer Bestand eines BtM-Präparats (Bewohnerbestand) ebenfalls nur mit Zweitunterschrift.
  const newStock = { name: "Morphin", strength: "10 mg", unit: "Tabletten", quantity: 20, residentId };
  assert.match((await failure(receiveStock(ctx, newStock))).message, /Zweitunterschrift/);
  await receiveStock(ctx, { ...newStock, witness: witness("lea") });
  // Andere Präparate brauchen weiterhin keine Zweitunterschrift.
  await receiveStock(ctx, { name: "Paracetamol", strength: "500 mg", unit: "Tabletten", quantity: 20, residentId });
});

test("BtM-Kennzeichnung: Aufheben nur mit Begründung, beides protokolliert", async () => {
  const f = await fixture();
  const ctx = await apiContextFor(f, "anna");
  const medication = randomUUID();
  await q(`INSERT INTO carecore_medications (id, organization_id, name) VALUES ($1, $2, 'Oxycodon')`, [
    medication,
    f.org,
  ]);
  await setControlled(ctx, medication, { controlled: true });
  assert.match((await failure(setControlled(ctx, medication, { controlled: false }))).message, /begründen/);
  await setControlled(ctx, medication, { controlled: false, reason: "Irrtümlich gekennzeichnet" });
  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_id = $1 ORDER BY created_at`,
    [medication],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["btm_marked", "btm_unmarked"],
  );
  const other = await fixture();
  assert.equal(
    (await failure(setControlled(await apiContextFor(other, "anna"), medication, { controlled: true }))).status,
    404,
  );
});

test("BtM-Kontrollintervall: ohne festgelegten Wert keine Fälligkeit, danach Erinnerung je Kontrollzyklus", async () => {
  const f = await fixture();
  const witness = await withPasswords(f);
  const ctx = await apiContextFor(f, "anna");
  const med = { ...ctx, actor: { ...ctx.actor, permissions: [...ctx.actor.permissions, "medication.manage"] } };
  const { stock } = await btmStock(f);
  const reminders = async () =>
    q<{ title: string; body: string }>(
      `SELECT title, body FROM carecore_notifications WHERE user_id = $1 AND type = 'btm_count_due' ORDER BY created_at`,
      [f.people.anna],
    );

  // Die Einrichtung legt das Intervall fest; ohne Wert lässt es sich nicht einschalten.
  assert.equal((await btmOverview(ctx)).countInterval, null);
  assert.equal((await btmOverview(ctx)).items[0].countDue, null);
  assert.match((await failure(saveSetting(ctx, "btmCountInterval", { enabled: true }))).message, /Wert/);
  await createBtmReminders(med);
  assert.equal((await reminders()).length, 0, "ohne Intervall keine Erinnerung");

  await saveSetting(ctx, "btmCountInterval", { enabled: true, value: 7 });
  let overview = await btmOverview(ctx);
  assert.equal(overview.countInterval, 7);
  assert.deepEqual(overview.items[0].countDue, { at: null, due: true }, "nie kontrolliert: sofort fällig");

  // Nur Personen mit Medikationsrecht, und je Zyklus nur einmal.
  await createBtmReminders(ctx);
  assert.equal((await reminders()).length, 0);
  await createBtmReminders(med);
  await createBtmReminders(med);
  assert.equal((await reminders()).length, 1);
  assert.match((await reminders())[0].body, /noch nie kontrolliert/);

  await countStock(ctx, stock, { counted: 10, witness: witness("max") });
  overview = await btmOverview(ctx);
  assert.equal(overview.items[0].countDue?.due, false);
  await createBtmReminders(med);
  assert.equal((await reminders()).length, 1, "nach der Kontrolle nicht fällig");

  // Kontrolle liegt 8 Tage zurück (die erste Erinnerung davor): wieder fällig, neue Erinnerung.
  await q(`UPDATE carecore_notifications SET created_at = NOW() - INTERVAL '9 days' WHERE user_id = $1`, [
    f.people.anna,
  ]);
  await q(`ALTER TABLE carecore_btm_counts DISABLE TRIGGER carecore_btm_count_guard`);
  await q(`UPDATE carecore_btm_counts SET created_at = NOW() - INTERVAL '8 days' WHERE stock_id = $1`, [stock]);
  await q(`ALTER TABLE carecore_btm_counts ENABLE TRIGGER carecore_btm_count_guard`);
  assert.equal((await btmOverview(ctx)).items[0].countDue?.due, true);
  await createBtmReminders(med);
  assert.equal((await reminders()).length, 2);
  assert.match((await reminders())[1].body, /letzte Kontrolle am/);

  // Personen mit anderem Stammwohnbereich erhalten keine Erinnerung für diesen Bestand.
  const ben = await apiContextFor(f, "ben");
  await createBtmReminders({ ...ben, actor: { ...ben.actor, permissions: ["medication.manage"] } });
  const [benCount] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_notifications WHERE user_id = $1 AND type = 'btm_count_due'`,
    [f.people.ben],
  );
  assert.equal(benCount.n, 0);
});

test("BtM-Gabe: Zweitunterschrift nur, wenn die Einrichtung sie verlangt, und nur für Betäubungsmittel", async () => {
  const f = await fixture();
  const witness = await withPasswords(f);
  const ctx = await apiContextFor(f, "anna");
  const residentId = await createResident(f);
  const weekAgo = localDate(new Date(Date.now() - 7 * 86_400_000), "Europe/Zurich");
  const order = async (name: string, controlled: boolean, prn: boolean) => {
    const orderId = await createOrder(
      ctx,
      residentId,
      parseOrderInput({
        name,
        strength: "10 mg",
        amount: "1 Tablette",
        stockQuantity: 1,
        prescribedBy: "Dr. Weber",
        startOn: weekAgo,
        ...(prn
          ? { isPrn: true, maxDosesPer24h: 6, minIntervalHours: 1, indication: "Schmerzen" }
          : { times: ["08:00"] }),
      }),
    );
    const [row] = await q<{ medication_id: string }>(
      `SELECT medication_id FROM carecore_medication_orders WHERE id = $1`,
      [orderId],
    );
    await q(`UPDATE carecore_medications SET is_controlled = $2 WHERE id = $1`, [row.medication_id, controlled]);
    await q(
      `INSERT INTO carecore_medication_stock (id, organization_id, resident_id, medication_id, quantity, unit) VALUES ($1, $2, $3, $4, 10, 'Tabletten')`,
      [randomUUID(), f.org, residentId, row.medication_id],
    );
    return orderId;
  };
  const yesterday = localDate(new Date(Date.now() - 86_400_000), "Europe/Zurich");
  const scheduledAt = zonedToUtc(yesterday, "08:00", "Europe/Zurich").toISOString();
  const morphin = await order("Morphin", true, false);
  const oxycodon = await order("Oxycodon", true, true);
  const metformin = await order("Metformin", false, false);

  // Ohne Einstellung genügt die eigene Unterschrift.
  await documentScheduledDose(ctx, { orderId: morphin, scheduledAt, status: "administered" });
  await documentScheduledDose(ctx, { orderId: morphin, scheduledAt, status: "declined", note: "Lehnt ab" });

  await saveSetting(ctx, "btmAdministrationWitness", { enabled: true });
  const dose = (extra: Record<string, unknown>) =>
    documentScheduledDose(ctx, { orderId: morphin, scheduledAt, status: "administered", ...extra });
  assert.match((await failure(dose({}))).message, /Zweitunterschrift/);
  assert.match((await failure(dose({ witness: witness("anna") }))).message, /anderen Person/);
  assert.match((await failure(dose({ witness: witness("sam") }))).message, /nicht für Medikation berechtigt/);
  await dose({ witness: witness("max") });
  // Verweigerungen und Nicht-BtM bleiben ohne Zweitunterschrift.
  await documentScheduledDose(ctx, { orderId: metformin, scheduledAt, status: "administered" });
  assert.match(
    (await failure(administerPrn(ctx, { orderId: oxycodon, note: "Schmerzen NRS 6" }))).message,
    /Zweitunterschrift/,
  );
  await administerPrn(ctx, { orderId: oxycodon, note: "Schmerzen NRS 6", witness: witness("lea") });

  const rows = await q<{ name: string; witness: string | null }>(
    `SELECT m.name, a.witness_user_id AS witness FROM carecore_medication_administrations a
       JOIN carecore_medication_orders o ON o.id = a.medication_order_id
       JOIN carecore_medications m ON m.id = o.medication_id
      WHERE a.resident_id = $1 ORDER BY m.name`,
    [residentId],
  );
  assert.deepEqual(rows, [
    { name: "Metformin", witness: null },
    { name: "Morphin", witness: f.people.max },
    { name: "Oxycodon", witness: f.people.lea },
  ]);
  const [movement] = await q<{ witness: string | null }>(
    `SELECT witness_user_id AS witness FROM carecore_medication_stock_movements
      WHERE resident_id = $1 AND reason = 'administration' AND delta < 0 ORDER BY created_at DESC LIMIT 1`,
    [residentId],
  );
  assert.equal(movement.witness, f.people.lea);
});
