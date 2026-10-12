import { test } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { decodeChmed, dosesBySlot, draftFromPlan } from "../lib/emediplan.ts";

// Beispiel aus der Spezifikation der IG eMediplan (ChTransmissionFormat, ReleaseYear 16, komprimiert).
const SPEC_EXAMPLE =
  "CHMED16A1H4sIAAAAAAAEAMVU3W7TMBR+lcq3S4SPHdtx7raVAaKFqutAAnoREreJ2jpT4gKj6ptxx4txnCwVSKQSu0GVqvPX7+fIpwdyuXcFSYiSFCjloGKtNQnI2GGRUZAh1SGwBUASyYTqC8oSSnHgVe4HZM7z1UqF6WcqwkhxjCKdhcJkWc650GIlcXZq8sXDvSEJtHGZpTtjXUOSj4cORyuIpWpRu0EekFnVDYzxmwbtZ+l13dTV7g9t5Ij1eZVicfYWMRab9byxmF1urMH8zpbezO3iNTkGj4RRJIHH7Bwj/J2RhUAHGa+2e/fF1PnPH9bu7XqAnHEhZHzGrqeGJ5EXVVbk9T7bfHr20tTfBwRAxCQHen7f/y7guqi2pnGmLm1j7MbUA/Qx1VLz8/aftvvf7L9Pm2ZQAQgBTEX/QwL+dJa6Et8/SQ7kqr0z0DGEFPxbDsh16R48lqktZjdv8FYwnabfyl2KhRfG5giasIBMTj3nWp4JPrmEjJ93J+fxx5PGTY3X1tbSzuHpGDthCPUu3eKM4O2Kujbr29C3QcSd9ex0udibYyKUWvbLZX3Au54EdupFfSD6QD4CCBEIBcsjjpJZUVnv6yJCxlEsYMRk+59z62pj/MLuLBreoe2vZj2KsfOhvMcyp0yhAzLfbbzj4y8tzloh3gQAAA==";

const rejects = (code: string, message: RegExp) =>
  assert.throws(
    () => decodeChmed(code),
    (error: Error) => message.test(error.message),
  );

test("eMediplan: Beispiel der Spezifikation (komprimiert) wird gelesen", () => {
  const { version, plan } = decodeChmed(SPEC_EXAMPLE);
  assert.equal(version, "CHMED16A");
  const draft = draftFromPlan(version, plan);
  assert.deepEqual(draft.patient, { firstName: "Maxima", lastName: "Matter", birthDate: "1981-01-12" });
  assert.equal(draft.author, "7601003178999");
  assert.equal(draft.lines.length, 6);
  const [acne, blood, pressure] = draft.lines;
  // Pharmacode: Bezeichnung nur über eine Arzneimitteldatenbank, daher keine.
  assert.deepEqual([acne.idType, acne.id, acne.freeText, acne.unit, acne.route], [3, "971867", null, "STK", "PO"]);
  assert.equal(acne.doses, null, "D = [0,0,0,0]: keine einfache Dosierung");
  assert.deepEqual(blood.doses, { morning: 0, noon: 1, evening: 0, night: 0 });
  assert.deepEqual([blood.reason, blood.from, blood.to, blood.reserve], ["Blutverdünnung", "2016-02-10", null, false]);
  assert.deepEqual(pressure.doses, { morning: 1, noon: 0, evening: 1, night: 0 });
});

test("eMediplan: unkomprimiert, Freitext, Reserve, komplexes Schema; Fehler verständlich", () => {
  const plan = {
    Patient: { FName: "Erna", LName: "Muster", BDt: "1938-04-02" },
    Medicaments: [
      { Id: "Paracetamol 500 mg Tabletten", IdType: 1, Unit: "STK", Pos: [{ DtFrom: "2026-10-01", InRes: 1 }] },
      { Id: "7680000000000", IdType: 2, Unit: "STK", Pos: [{ DtFrom: "2026-10-01", D: [1, 0, 0.5, 0] }] },
      { Id: "1234567", IdType: 3, Pos: [{ DtFrom: "2026-10-01", TT: [{ Off: 28800, DoFrom: 1 }] }] },
      {
        Id: "Vitamin D",
        IdType: 1,
        Pos: [
          { DtFrom: "2026-10-01", D: [1] },
          { DtFrom: "2026-11-01", D: [2] },
        ],
      },
    ],
  };
  const plain = draftFromPlan("CHMED16A", decodeChmed(`CHMED16A0${JSON.stringify(plan)}`).plan);
  const zipped = draftFromPlan(
    "CHMED16A",
    decodeChmed(`chmed16a1${gzipSync(Buffer.from(JSON.stringify(plan))).toString("base64")}`).plan,
  );
  assert.deepEqual(plain, zipped, "Gross-/Kleinschreibung des Präfixes und Kompression ändern nichts");
  const [prn, split, timed, two] = plain.lines;
  assert.deepEqual([prn.freeText, prn.reserve, prn.doses], ["Paracetamol 500 mg Tabletten", true, null]);
  assert.deepEqual(dosesBySlot(split.doses!), [
    { dose: 1, slots: ["morning"] },
    { dose: 0.5, slots: ["evening"] },
  ]);
  assert.deepEqual([timed.complex, timed.doses], [true, null]);
  assert.equal(two.complex, true, "mehrere Dosierungen: von Hand erfassen");
  assert.deepEqual(dosesBySlot({ morning: 1, noon: 1, evening: 1, night: 0 }), [
    { dose: 1, slots: ["morning", "noon", "evening"] },
  ]);

  rejects("", /einfügen oder scannen/);
  rejects("Hallo", /kein eMediplan/);
  rejects("CHMED23A.H4sIAAAA", /beschädigt/);
  rejects("CHMED15A0{}", /nicht unterstützt/);
  rejects("CHMED16A1nichtbase64", /beschädigt/);
  rejects('CHMED16A0{"Patient":{}}', /keine Medikamente/);
});

// Beispiel aus dem Objektmodell CHMED23A der IG eMediplan (README): Dora Graber, täglich 1 Tablette um 08:00.
const CHMED23_EXAMPLE = {
  patient: { fName: "Dora", lName: "Graber", bdt: "1951-11-06", gender: 2 },
  meds: [
    {
      id: "Med1",
      idType: 1,
      pos: [
        {
          po: {
            t: 4,
            cyDuU: 4,
            cyDu: 1,
            tdo: { t: 2, ts: [{ dt: "08:00:00", do: { t: 1, a: 1 } }] },
            tdpc: 1,
          },
        },
      ],
      unit: "TABL",
      nbPack: 1.0,
    },
  ],
  medType: 1,
  id: "9196a4e4-3439-4714-b89a-89402db30c02",
  auth: 2,
  dt: "2023-07-14T12:40:57.1203496+02:00",
};
const zip23 = (plan: unknown) => gzipSync(Buffer.from(JSON.stringify(plan))).toString("base64");

test("eMediplan CHMED23A: Beispiel des Objektmodells, Teile aus mehreren QR-Codes, tägliche Dosierungen", () => {
  const { version, plan } = decodeChmed(`CHMED23A.${zip23(CHMED23_EXAMPLE)}`);
  assert.equal(version, "CHMED23A");
  const draft = draftFromPlan(version, plan);
  assert.deepEqual(draft.patient, { firstName: "Dora", lastName: "Graber", birthDate: "1951-11-06" });
  const [line] = draft.lines;
  assert.deepEqual(
    [line.freeText, line.unit, line.doses, line.timedDoses, line.complex],
    ["Med1", "", null, [{ time: "08:00", dose: 1 }], false],
  );

  // Auf drei QR-Codes verteilt, in beliebiger Reihenfolge gescannt.
  const data = zip23(CHMED23_EXAMPLE);
  const size = Math.ceil(data.length / 3);
  const chunks = [0, 1, 2].map((index) => `CHMED23A.${index + 1}/3.${data.slice(index * size, (index + 1) * size)}`);
  assert.deepEqual(decodeChmed([chunks[2], chunks[0], chunks[1]].join("\n")).plan, CHMED23_EXAMPLE);
  rejects([chunks[0], chunks[2]].join("\n"), /fehlen Teile des eMediplans \(2 von 3\)/);

  const med = (po: unknown, extra: Record<string, unknown> = {}) => ({
    patient: { fName: "Erna", lName: "Muster" },
    meds: [
      {
        id: "7680123456789",
        idType: 2,
        rsn: "Blutdruck",
        pos: [{ dtFrom: "2026-10-01T00:00:00+02:00", unit: "TABL", po, ...extra }],
      },
    ],
  });
  const read = (plan: unknown) => draftFromPlan("CHMED23A", decodeChmed(`CHMED23A.${zip23(plan)}`).plan).lines[0];
  const daily = read(med({ t: 1, ds: [1, 0, 0.5, 0] }));
  assert.deepEqual(
    [daily.doses, daily.from, daily.unit, daily.reason, daily.complex],
    [{ morning: 1, noon: 0, evening: 0.5, night: 0 }, "2026-10-01", "TABL", "Blutdruck", false],
  );
  const segments = read(med({ t: 4, cyDuU: 4, cyDu: 1, tdo: { t: 3, ss: [{ s: 3, do: { t: 1, a: 2 } }] } }));
  assert.deepEqual(segments.doses, { morning: 0, noon: 0, evening: 2, night: 0 });
  // Wöchentlich, Intervall, Dosis von–bis, Freitext: von Hand.
  const weekly = read(med({ t: 4, cyDuU: 5, cyDu: 1, tdo: { t: 1, do: { t: 1, a: 1 } } }));
  assert.deepEqual([weekly.complex, weekly.doses, weekly.timedDoses], [true, null, null]);
  assert.equal(
    read(med({ t: 4, cyDuU: 4, cyDu: 1, tdo: { t: 2, ts: [{ dt: "08:00:00", do: { t: 2, af: 1, at: 2 } }] } })).complex,
    true,
  );
  const text = read(med({ t: 2, text: "nach Rücksprache" }));
  assert.deepEqual([text.complex, text.instructions], [true, "nach Rücksprache"]);
  const reserve = read(med({ t: 1, ds: [0, 0, 0, 0] }, { inRes: true }));
  assert.deepEqual([reserve.reserve, reserve.complex], [true, false]);
});
