import { test } from "node:test";
import assert from "node:assert/strict";
import { absenceOn, billedOn, careLevelOn, computeMonth, monthDays, priceOn } from "@/lib/billing-calc";
import type { BillingRate } from "@/lib/billing-shared";

const rate = (patch: Partial<BillingRate> & Pick<BillingRate, "id" | "prices">): BillingRate => ({
  name: patch.id,
  category: "pension",
  payer: "resident",
  careLevel: null,
  applies: "all",
  hospital: null,
  absence: null,
  archived: false,
  ...patch,
});

test("Abrechnung: Tage, Aufenthalt, Abwesenheit, Stufe und Preis je Tag", () => {
  assert.equal(monthDays("2026-02").length, 28);
  assert.equal(monthDays("2028-02").at(-1), "2028-02-29");
  const stays = [{ from: "2026-03-10", until: "2026-03-20" }];
  assert.equal(billedOn("2026-03-09", stays, false), false);
  assert.equal(billedOn("2026-03-10", stays, false), true);
  assert.equal(billedOn("2026-03-20", stays, false), false);
  assert.equal(billedOn("2026-03-20", stays, true), true);
  assert.equal(billedOn("2026-04-01", [{ from: "2026-03-10", until: null }], false), true);
  assert.deepEqual(absenceOn("2026-03-12", [{ kind: "hospital", startsOn: "2026-03-10", endsOn: null }]), {
    kind: "hospital",
    number: 3,
  });
  assert.equal(absenceOn("2026-03-09", [{ kind: "hospital", startsOn: "2026-03-10", endsOn: "2026-03-11" }]), null);
  const levels = [
    { level: "Pflegestufe 3", validFrom: "2026-01-01" },
    { level: "Pflegestufe 5", validFrom: "2026-03-15" },
  ];
  assert.equal(careLevelOn("2025-12-31", levels), null);
  assert.equal(careLevelOn("2026-03-14", levels), "Pflegestufe 3");
  assert.equal(careLevelOn("2026-03-15", levels), "Pflegestufe 5");
  const priced = {
    prices: [
      { validFrom: "2026-03-16", amountCents: 200 },
      { validFrom: "2026-01-01", amountCents: 100 },
    ],
  };
  assert.equal(priceOn("2025-12-31", priced), null);
  assert.equal(priceOn("2026-03-15", priced), 100);
  assert.equal(priceOn("2026-03-16", priced), 200);
});

test("Abrechnung: Monat mit Preiswechsel, Stufenwechsel, Spital, Ferien und zugewiesener Taxe", () => {
  const rates = [
    rate({
      id: "pension",
      prices: [
        { validFrom: "2026-01-01", amountCents: 15000 },
        { validFrom: "2026-04-21", amountCents: 16000 },
      ],
      hospital: { fullDays: 3, percent: 50 },
      absence: { fullDays: 0, percent: 80 },
    }),
    rate({ id: "single", applies: "assigned", prices: [{ validFrom: "2026-01-01", amountCents: 1000 }] }),
    rate({
      id: "kvg3",
      category: "care",
      payer: "insurer",
      careLevel: "Pflegestufe 3",
      prices: [{ validFrom: "2026-01-01", amountCents: 2880 }],
      hospital: { fullDays: 0, percent: 0 },
    }),
    rate({ id: "old", archived: true, prices: [{ validFrom: "2026-01-01", amountCents: 999 }] }),
  ];
  const month = computeMonth({
    month: "2026-04",
    stays: [{ from: "2026-04-03", until: null }],
    dischargeDayBilled: false,
    rates,
    careLevels: [
      { level: "Pflegestufe 3", validFrom: "2026-04-05" },
      { level: "Pflegestufe 4", validFrom: "2026-04-25" },
    ],
    // Spital 5 Tage (10.–14.), Ferien 2 Tage (28.–29.).
    absences: [
      { kind: "hospital", startsOn: "2026-04-10", endsOn: "2026-04-14" },
      { kind: "vacation", startsOn: "2026-04-28", endsOn: "2026-04-29" },
    ],
    assigned: [{ rateId: "single", validFrom: "2026-04-20", validUntil: "2026-04-21" }],
  });
  assert.equal(month.billedDays, 28);
  assert.deepEqual(month.absentDays, { hospital: 5, absence: 2 });
  const lines = month.lines.map((line) => [
    line.rateId,
    line.priceCents,
    line.fullDays,
    line.reduced,
    line.amountCents,
  ]);
  assert.deepEqual(lines, [
    // 3.–20. April: 18 Tage, davon Spital 10.–14.: 3 voll, 2 zu 50 %.
    ["pension", 15000, 16, [{ days: 2, percent: 50, kind: "hospital" }], 16 * 15000 + 15000],
    // 21.–30. April: 10 Tage, davon Ferien 28.–29. zu 80 %.
    ["pension", 16000, 8, [{ days: 2, percent: 80, kind: "absence" }], 8 * 16000 + 25600],
    ["single", 1000, 2, [], 2000],
    // Stufe 3 vom 5. bis 24. April: 20 Tage, davon 5 Spitaltage zu 0 %.
    ["kvg3", 2880, 15, [{ days: 5, percent: 0, kind: "hospital" }], 15 * 2880],
  ]);
  assert.deepEqual(month.totals, [
    { payer: "resident", amountCents: 255000 + 153600 + 2000 },
    { payer: "insurer", amountCents: 43200 },
  ]);
  assert.equal(month.totalCents, 255000 + 153600 + 2000 + 43200);
  assert.deepEqual(month.warnings, [
    "An 2 Tagen ist keine Pflegestufe erfasst; Pflege wird dafür nicht verrechnet.",
    "Für „Pflegestufe 4“ ist kein Pflegetarif erfasst.",
  ]);
});

test("Abrechnung: Austrittstag nach Regel der Einrichtung, Rundung je Zeile", () => {
  const rates = [
    rate({ id: "p", prices: [{ validFrom: "2026-01-01", amountCents: 333 }], absence: { fullDays: 0, percent: 50 } }),
  ];
  const base = {
    month: "2026-05",
    stays: [{ from: "2026-05-01", until: "2026-05-04" }],
    rates,
    careLevels: [{ level: "x", validFrom: "2026-01-01" }],
    absences: [{ kind: "other" as const, startsOn: "2026-05-01", endsOn: "2026-05-03" }],
    assigned: [],
  };
  const without = computeMonth({ ...base, dischargeDayBilled: false });
  assert.equal(without.billedDays, 3);
  // 3 Tage zu 50 % von 3.33 = 4.995 → 5.00 (gerundet je Zeile, nicht je Tag).
  assert.equal(without.totalCents, 500);
  const withDay = computeMonth({ ...base, dischargeDayBilled: true });
  assert.equal(withDay.billedDays, 4);
  assert.equal(withDay.totalCents, 500 + 333);
});
