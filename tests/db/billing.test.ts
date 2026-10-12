import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ApiError, type ApiContext } from "@/lib/api-context";
import {
  addAbsence,
  addCareLevel,
  archiveRate,
  assignRate,
  billingCatalog,
  billingPerson,
  cancelBillingEntry,
  createRate,
  endAssignedRate,
  saveBillingSettings,
  setRatePrice,
  updateAbsence,
  updateRate,
} from "@/lib/billing";
import { apiContextFor, createResident, fixture, q } from "../support/db";

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof ApiError, String(error));
    return error;
  }
  assert.fail("Fehler erwartet");
}

const withBilling = (ctx: ApiContext) =>
  ({
    ...ctx,
    actor: { ...ctx.actor, permissions: [...new Set([...ctx.actor.permissions, "billing.manage"])] },
  }) as ApiContext;

test("Abrechnung: Taxen mit Preisen ab Datum, Pflegetarife je Stufe, Regel zum Austrittstag", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const office = withBilling(await apiContextFor(f, "leadA"));
  assert.equal((await failure(billingCatalog(nurse))).status, 403);

  let catalog = await billingCatalog(office);
  assert.equal(catalog.currency, "CHF");
  assert.equal(catalog.levelLabel, "Pflegestufe");
  assert.equal(catalog.levels.length, 12);
  assert.deepEqual(catalog.rates, []);
  assert.deepEqual(catalog.settings, { dischargeDayBilled: null });

  // Pflichtangaben und Prüfungen.
  const base = { name: "Pension", category: "pension", payer: "resident", validFrom: "2026-01-01", amountCents: 14500 };
  assert.match((await failure(createRate(office, { ...base, category: "x" }))).message, /Art der Taxe/);
  assert.match((await failure(createRate(office, { ...base, payer: "x" }))).message, /bezahlt/);
  assert.match((await failure(createRate(office, { ...base, amountCents: -1 }))).message, /Betrag/);
  assert.match(
    (await failure(createRate(office, { ...base, hospital: { fullDays: 2, percent: 120 } }))).message,
    /Prozentsatz/,
  );
  assert.match(
    (await failure(createRate(office, { ...base, category: "care", careLevel: "Stufe 99" }))).message,
    /gültige Pflegestufe/,
  );

  const pension = await createRate(office, { ...base, hospital: { fullDays: 3, percent: 50 } });
  await setRatePrice(office, pension.id, { validFrom: "2026-03-16", amountCents: 15000 });
  // Gleiches Datum ersetzt den Preis.
  await setRatePrice(office, pension.id, { validFrom: "2026-03-16", amountCents: 15500 });
  const kvg = await createRate(office, {
    name: "Pflegestufe 3 · KVG",
    category: "care",
    careLevel: "Pflegestufe 3",
    payer: "insurer",
    applies: "assigned",
    validFrom: "2026-01-01",
    amountCents: 2880,
    hospital: { fullDays: 0, percent: 0 },
  });
  assert.equal(
    (
      await failure(
        createRate(office, {
          ...base,
          category: "care",
          careLevel: "Pflegestufe 3",
          payer: "insurer",
          name: "doppelt",
        }),
      )
    ).status,
    409,
  );
  const single = await createRate(office, {
    name: "Zuschlag Einzelzimmer",
    category: "extra",
    payer: "resident",
    applies: "assigned",
    validFrom: "2026-01-01",
    amountCents: 1000,
  });
  await updateRate(office, single.id, { name: "Einzelzimmer", payer: "resident", applies: "assigned" });
  assert.match(
    (await failure(updateRate(office, kvg.id, { name: "x", payer: "resident" }))).message,
    /Kostenträger nicht ändern/,
  );
  const unused = await createRate(office, { ...base, name: "Alt", amountCents: 999 });
  await archiveRate(office, unused.id);

  catalog = await billingCatalog(office);
  const byId = new Map(catalog.rates.map((rate) => [rate.id, rate]));
  assert.deepEqual(byId.get(pension.id)?.prices, [
    { validFrom: "2026-01-01", amountCents: 14500 },
    { validFrom: "2026-03-16", amountCents: 15500 },
  ]);
  assert.deepEqual(byId.get(pension.id)?.hospital, { fullDays: 3, percent: 50 });
  assert.equal(byId.get(kvg.id)?.applies, "all", "Pflegetarife gelten immer für alle mit dieser Stufe");
  assert.equal(byId.get(single.id)?.name, "Einzelzimmer");
  assert.equal(byId.get(unused.id)?.archived, true);
  assert.equal(catalog.rates.at(-1)?.id, unused.id, "nicht mehr verwendete Taxen zuletzt");

  assert.match((await failure(saveBillingSettings(office, {}))).message, /Austrittstag/);
  await saveBillingSettings(office, { dischargeDayBilled: false });
  assert.deepEqual((await billingCatalog(office)).settings, { dischargeDayBilled: false });

  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_id = $1 ORDER BY created_at`,
    [pension.id],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["created", "price_set", "price_set"],
  );
});

test("Abrechnung je Person: Stufe, Abwesenheit, zusätzliche Taxe, Vorschau und Stornieren", async () => {
  const f = await fixture();
  const office = withBilling(await apiContextFor(f, "leadA"));
  const erna = await createResident(f, "Erna Muster");
  await q(`UPDATE carecore_resident_stays SET started_at = '2026-03-03T10:00:00Z' WHERE resident_id = $1`, [erna]);

  const pension = await createRate(office, {
    name: "Pension",
    category: "pension",
    payer: "resident",
    validFrom: "2026-01-01",
    amountCents: 10000,
    hospital: { fullDays: 2, percent: 50 },
  });
  await createRate(office, {
    name: "Pflegestufe 3 · KVG",
    category: "care",
    careLevel: "Pflegestufe 3",
    payer: "insurer",
    validFrom: "2026-01-01",
    amountCents: 2000,
    hospital: { fullDays: 0, percent: 0 },
  });
  const single = await createRate(office, {
    name: "Einzelzimmer",
    category: "extra",
    payer: "resident",
    applies: "assigned",
    validFrom: "2026-01-01",
    amountCents: 500,
  });

  // Ohne Regel zum Austrittstag keine Vorschau.
  let person = await billingPerson(office, erna, "2026-03");
  assert.equal(person.preview, null);
  await saveBillingSettings(office, { dischargeDayBilled: true });

  await addCareLevel(office, { residentId: erna, level: "Pflegestufe 3", validFrom: "2026-03-10", note: "Einstufung" });
  assert.equal(
    (await failure(addCareLevel(office, { residentId: erna, level: "Pflegestufe 4", validFrom: "2026-03-10" }))).status,
    409,
  );
  const hospital = await addAbsence(office, { residentId: erna, kind: "hospital", startsOn: "2026-03-20" });
  assert.equal(
    (
      await failure(
        addAbsence(office, { residentId: erna, kind: "vacation", startsOn: "2026-03-25", endsOn: "2026-03-26" }),
      )
    ).status,
    409,
    "offene Abwesenheit überschneidet sich",
  );
  assert.match(
    (await failure(addAbsence(office, { residentId: erna, kind: "x", startsOn: "2026-03-01" }))).message,
    /Art der Abwesenheit/,
  );
  await updateAbsence(office, hospital.id, { kind: "hospital", startsOn: "2026-03-20", endsOn: "2026-03-23" });
  const assigned = await assignRate(office, { residentId: erna, rateId: single.id, validFrom: "2026-03-01" });
  await endAssignedRate(office, assigned.id, { validUntil: "2026-03-10" });
  assert.match(
    (await failure(assignRate(office, { residentId: erna, rateId: pension.id, validFrom: "2026-03-01" }))).message,
    /für alle Personen/,
  );

  person = await billingPerson(office, erna, "2026-03");
  assert.equal(person.careLevels[0].level, "Pflegestufe 3");
  assert.deepEqual(
    person.absences.map((absence) => [absence.kind, absence.startsOn, absence.endsOn]),
    [["hospital", "2026-03-20", "2026-03-23"]],
  );
  assert.deepEqual(
    person.assigned.map((rate) => [rate.name, rate.validFrom, rate.validUntil]),
    [["Einzelzimmer", "2026-03-01", "2026-03-10"]],
  );
  const preview = person.preview;
  assert.ok(preview);
  // 3.–31. März: 29 Tage; Spital 20.–23.: 4 Tage.
  assert.equal(preview.billedDays, 29);
  assert.deepEqual(preview.absentDays, { hospital: 4, absence: 0 });
  assert.deepEqual(
    preview.lines.map((line) => [line.name, line.fullDays, line.reduced, line.amountCents]),
    [
      ["Pension", 27, [{ days: 2, percent: 50, kind: "hospital" }], 27 * 10000 + 10000],
      // Stufe ab 10. März: 22 Tage, davon 4 Spitaltage zu 0 %.
      ["Pflegestufe 3 · KVG", 18, [{ days: 4, percent: 0, kind: "hospital" }], 18 * 2000],
      // Einzelzimmer 3.–10. März.
      ["Einzelzimmer", 8, [], 4000],
    ],
  );
  assert.deepEqual(preview.totals, [
    { payer: "resident", amountCents: 280000 + 4000 },
    { payer: "insurer", amountCents: 36000 },
  ]);
  assert.deepEqual(preview.warnings, ["An 7 Tagen ist keine Pflegestufe erfasst; Pflege wird dafür nicht verrechnet."]);

  // Stornieren mit Grund: zählt nicht mehr, bleibt im Protokoll der Akte.
  assert.match((await failure(cancelBillingEntry(office, "absences", hospital.id, { reason: "" }))).message, /Grund/);
  await cancelBillingEntry(office, "absences", hospital.id, { reason: "falsche Person" });
  assert.equal((await failure(cancelBillingEntry(office, "absences", hospital.id, { reason: "x" }))).status, 409);
  person = await billingPerson(office, erna, "2026-03");
  assert.deepEqual(person.absences, []);
  assert.deepEqual(person.preview?.absentDays, { hospital: 0, absence: 0 });
  const log = await q<{ entity_type: string; action: string }>(
    `SELECT entity_type, action FROM carecore_audit_log WHERE after_data->>'residentId' = $1 ORDER BY created_at`,
    [erna],
  );
  assert.deepEqual(
    log.map((row) => `${row.entity_type}:${row.action}`).filter((entry) => !entry.startsWith("resident:")),
    [
      "care_level:created",
      "resident_absence:created",
      "resident_absence:updated",
      "resident_rate:created",
      "resident_rate:updated",
      "resident_absence:cancelled",
    ],
  );

  // Andere Einrichtungen sehen weder Personen noch Einträge.
  const other = await fixture();
  const stranger = withBilling(await apiContextFor(other, "leadA"));
  assert.equal((await failure(billingPerson(stranger, erna, null))).status, 404);
  assert.equal((await failure(cancelBillingEntry(stranger, "rates", assigned.id, { reason: "x" }))).status, 404);
  assert.equal(
    (await failure(setRatePrice(stranger, pension.id, { validFrom: "2026-01-01", amountCents: 1 }))).status,
    404,
  );
  assert.equal((await failure(billingPerson(office, randomUUID(), null))).status, 404);
});
