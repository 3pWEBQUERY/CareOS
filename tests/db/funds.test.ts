import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import { cancelFundEntry, createFundCount, createFundEntry, fundAccount, fundCash } from "@/lib/funds";
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

const withFunds = (ctx: ApiContext) =>
  ({
    ...ctx,
    actor: { ...ctx.actor, permissions: [...new Set([...ctx.actor.permissions, "funds.manage"])] },
  }) as ApiContext;

test("Bewohnergelder: Buchen, Guthaben nie unter null, Storno mit Grund, Monatsstände und Protokoll", async () => {
  const f = await fixture();
  const nurse = await apiContextFor(f, "anna");
  const office = withFunds(await apiContextFor(f, "leadA"));
  const erna = await createResident(f, "Erna Muster");
  const today = (await fundAccount(office, erna, null)).today;
  const month = today.slice(0, 7);
  const lastMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)) - 2, 15))
    .toISOString()
    .slice(0, 10);

  // Ohne Recht weder buchen noch die Kasse sehen.
  assert.equal(
    (
      await failure(
        createFundEntry(nurse, { residentId: erna, kind: "deposit", amountCents: 1000, bookedOn: today, purpose: "x" }),
      )
    ).status,
    403,
  );
  assert.equal((await failure(fundCash(nurse))).status, 403);

  const base = { residentId: erna, bookedOn: today };
  assert.equal(
    (await failure(createFundEntry(office, { ...base, kind: "deposit", amountCents: 0, purpose: "Taschengeld" })))
      .message,
    "Der Betrag ist ungültig.",
  );
  assert.equal(
    (await failure(createFundEntry(office, { ...base, kind: "deposit", amountCents: 1.5, purpose: "Taschengeld" })))
      .message,
    "Der Betrag ist ungültig.",
  );
  assert.equal(
    (await failure(createFundEntry(office, { ...base, kind: "deposit", amountCents: 500, purpose: " " }))).message,
    "Bitte den Zweck angeben.",
  );
  assert.equal(
    (await failure(createFundEntry(office, { ...base, kind: "gift", amountCents: 500, purpose: "x" }))).message,
    "Bitte die Art der Buchung wählen.",
  );
  assert.equal(
    (
      await failure(
        createFundEntry(office, { ...base, bookedOn: "2999-01-01", kind: "deposit", amountCents: 500, purpose: "x" }),
      )
    ).message,
    "Buchungen in der Zukunft sind nicht möglich.",
  );
  // Leeres Konto: eine Ausgabe würde das Guthaben unter null bringen.
  const empty = await failure(
    createFundEntry(office, { ...base, kind: "expense", amountCents: 100, purpose: "Kiosk" }),
  );
  assert.equal(empty.status, 409);

  // Einzahlung im Vormonat, Ausgabe und Auszahlung in diesem Monat.
  const { id: deposit } = await createFundEntry(office, {
    ...base,
    bookedOn: lastMonth,
    kind: "deposit",
    amountCents: 20000,
    purpose: "Taschengeld",
    party: "Tochter",
  });
  const { id: hair } = await createFundEntry(office, {
    ...base,
    kind: "expense",
    amountCents: 4550,
    purpose: "Coiffeur",
    party: "Coiffeur Muster",
    receipt: "Q-12",
  });
  await createFundEntry(office, { ...base, kind: "payout", amountCents: 2000, purpose: "Bargeld für den Markt" });
  // Mehr als das Guthaben geht nicht.
  assert.equal(
    (await failure(createFundEntry(office, { ...base, kind: "payout", amountCents: 13451, purpose: "zu viel" })))
      .status,
    409,
  );

  let account = await fundAccount(office, erna, month);
  assert.equal(account.currency, "CHF");
  assert.equal(account.balanceCents, 13450);
  assert.equal(account.openingCents, 20000, "Anfangsbestand: Einzahlung des Vormonats");
  assert.equal(account.closingCents, 13450);
  assert.equal(account.depositsCents, 0);
  assert.equal(account.withdrawalsCents, 6550);
  assert.deepEqual(account.entries.map((entry) => [entry.kind, entry.amountCents, entry.purpose]).sort(), [
    ["expense", 4550, "Coiffeur"],
    ["payout", 2000, "Bargeld für den Markt"],
  ]);
  assert.equal(account.resident.name, "Muster Erna");
  assert.equal((await fundAccount(office, erna, lastMonth.slice(0, 7))).entries[0].party, "Tochter");

  // Storno: Grund ist Pflicht, die Buchung bleibt sichtbar und zählt nicht mehr; zweimal geht nicht.
  assert.equal((await failure(cancelFundEntry(office, hair, { reason: " " }))).message, "Bitte einen Grund angeben.");
  await cancelFundEntry(office, hair, { reason: "Falsche Person" });
  assert.equal((await failure(cancelFundEntry(office, hair, { reason: "nochmals" }))).status, 409);
  account = await fundAccount(office, erna, month);
  assert.equal(account.balanceCents, 18000);
  assert.equal(account.entries.find((entry) => entry.id === hair)?.cancelled?.reason, "Falsche Person");

  // Die Einzahlung zu stornieren brächte das Guthaben unter null (die Auszahlung bleibt bestehen).
  assert.equal((await failure(cancelFundEntry(office, deposit, { reason: "Irrtum" }))).status, 409);

  // Protokoll in der Akte.
  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE entity_type = 'fund_entry' AND after_data->>'residentId' = $1 ORDER BY created_at`,
    [erna],
  );
  assert.deepEqual(
    audit.map((row) => row.action),
    ["created", "created", "created", "cancelled"],
  );

  // Andere Einrichtung: Person unbekannt.
  const other = withFunds(await apiContextFor(await fixture(), "leadA"));
  assert.equal((await failure(fundAccount(other, erna, null))).status, 404);
  assert.equal((await failure(cancelFundEntry(other, deposit, { reason: "x" }))).status, 404);
});

test("Bewohnergelder: Kasse mit Sollbestand aller Konten, Kassenkontrolle mit erklärter Differenz", async () => {
  const f = await fixture();
  const office = withFunds(await apiContextFor(f, "leadA"));
  const erna = await createResident(f, "Erna Muster");
  const hans = await createResident(f, "Hans Beispiel");
  const today = (await fundAccount(office, erna, null)).today;
  await createFundEntry(office, {
    residentId: erna,
    bookedOn: today,
    kind: "deposit",
    amountCents: 10000,
    purpose: "Barbetrag",
  });
  await createFundEntry(office, {
    residentId: hans,
    bookedOn: today,
    kind: "deposit",
    amountCents: 5025,
    purpose: "Barbetrag",
  });

  let cash = await fundCash(office);
  assert.equal(cash.totalCents, 15025);
  assert.deepEqual(
    cash.accounts.map((account) => [account.name, account.balanceCents]),
    [
      ["Beispiel Hans", 5025],
      ["Muster Erna", 10000],
    ],
  );

  // Gleich viel gezählt: keine Bemerkung nötig. Abweichung nur mit Erklärung.
  await createFundCount(office, { countedCents: 15025, witness: "Max Meier" });
  assert.equal(
    (await failure(createFundCount(office, { countedCents: 15000 }))).message,
    "Der gezählte Betrag weicht vom Sollbestand ab. Bitte die Differenz in der Bemerkung erklären.",
  );
  await createFundCount(office, { countedCents: 15000, note: "25 Rappen Wechselgeld fehlen" });
  assert.equal(
    (await failure(createFundCount(office, { countedCents: -1 }))).message,
    "Der gezählte Betrag ist ungültig.",
  );

  cash = await fundCash(office);
  assert.deepEqual(
    cash.counts.map((count) => [count.countedCents, count.expectedCents, count.note]),
    [
      [15000, 15025, "25 Rappen Wechselgeld fehlen"],
      [15025, 15025, ""],
    ],
  );
  assert.equal(cash.counts[1].witness, "Max Meier");

  // Deutschland bzw. Österreich: Euro.
  await q(`UPDATE carecore_organizations SET country = 'DE' WHERE id = $1`, [f.org]);
  assert.equal((await fundCash(office)).currency, "EUR");
});

test("Bewohnergelder: gleichzeitige Auszahlungen bringen das Guthaben nicht unter null", async () => {
  const f = await fixture();
  const office = withFunds(await apiContextFor(f, "leadA"));
  const erna = await createResident(f, "Erna Muster");
  const today = (await fundAccount(office, erna, null)).today;
  await createFundEntry(office, {
    residentId: erna,
    bookedOn: today,
    kind: "deposit",
    amountCents: 10000,
    purpose: "Barbetrag",
  });
  const payout = () =>
    createFundEntry(office, {
      residentId: erna,
      bookedOn: today,
      kind: "payout",
      amountCents: 8000,
      purpose: "Ausflug",
    });
  const results = await Promise.allSettled([payout(), payout(), payout()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal((await fundAccount(office, erna, null)).balanceCents, 2000);
});
