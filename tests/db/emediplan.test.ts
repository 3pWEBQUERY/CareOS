import { test } from "node:test";
import assert from "node:assert/strict";
import { ApiError, type ApiContext } from "@/lib/api-context";
import type { Permission } from "@/lib/server-data";
import { adoptEmediplanLine, readEmediplan } from "@/lib/emediplan-review";
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

const withPermission = (ctx: ApiContext, ...permissions: Permission[]): ApiContext => ({
  ...ctx,
  actor: { ...ctx.actor, permissions: [...ctx.actor.permissions, ...permissions] },
});

const plan = (lastName: string) =>
  `CHMED16A0${JSON.stringify({
    Auth: "7601000000000",
    Dt: "2026-10-01T10:00:00+02:00",
    Patient: { FName: "Erna", LName: lastName, BDt: "1938-04-02" },
    Medicaments: [
      {
        Id: "7680123456789",
        IdType: 2,
        Unit: "STK",
        Roa: "PO",
        TkgRsn: "Blutdruck",
        Pos: [{ DtFrom: "2026-10-01", D: [1, 0, 0.5, 0] }],
      },
      {
        Id: "Paracetamol 500 mg",
        IdType: 1,
        Unit: "STK",
        TkgRsn: "Schmerzen",
        Pos: [{ DtFrom: "2026-10-01", InRes: 1 }],
      },
    ],
  })}`;

test("eMediplan: lesen mit Personenabgleich, Zeile einzeln übernehmen, Zuordnung merken", async () => {
  const f = await fixture();
  const reader = await apiContextFor(f, "anna");
  const ctx = withPermission(reader, "medication.manage");
  const erna = await createResident(f, "Erna Muster");
  await q(`UPDATE carecore_residents SET date_of_birth = '1938-04-02' WHERE id = $1`, [erna]);

  assert.equal((await failure(readEmediplan(reader, erna, plan("Muster")))).status, 403);
  assert.match((await failure(readEmediplan(ctx, erna, "kein Code"))).message, /kein eMediplan/);

  let draft = await readEmediplan(ctx, erna, plan("Mustermann"));
  assert.deepEqual(draft.patientMismatch, ["Name im Plan: Erna Mustermann, in der Akte: Erna Muster"]);
  draft = await readEmediplan(ctx, erna, plan("Muster"));
  assert.deepEqual(draft.patientMismatch, []);
  assert.equal(draft.lines[0].match, null, "GTIN noch keinem Präparat zugeordnet");

  // Übernehmen: dieselben Pflichtangaben wie im Medikamentenplan.
  const line = {
    residentId: erna,
    name: "Amlodipin",
    strength: "5 mg",
    form: "Tablette",
    route: "PO",
    indication: "Blutdruck",
    startOn: "2026-10-01",
    idType: 2,
    code: "7680123456789",
  };
  assert.match(
    (await failure(adoptEmediplanLine(ctx, { ...line, amount: "1 STK", times: ["08:00"], prescribedBy: "" }))).message,
    /verordnende/,
  );
  assert.match(
    (
      await failure(
        adoptEmediplanLine(ctx, {
          ...line,
          code: "12ab",
          amount: "1 STK",
          times: ["08:00"],
          prescribedBy: "Dr. Meier",
        }),
      )
    ).message,
    /GTIN/,
  );
  await adoptEmediplanLine(ctx, { ...line, amount: "1 STK", times: ["08:00"], prescribedBy: "Dr. Meier" });
  await adoptEmediplanLine(ctx, { ...line, amount: "0,5 STK", times: ["18:00"], prescribedBy: "Dr. Meier" });
  await adoptEmediplanLine(ctx, {
    residentId: erna,
    name: "Paracetamol 500 mg",
    amount: "1 STK",
    isPrn: true,
    maxDosesPer24h: 4,
    minIntervalHours: 6,
    indication: "Schmerzen",
    prescribedBy: "Dr. Meier",
    startOn: "2026-10-01",
    idType: 1,
    code: "Paracetamol 500 mg",
  });
  const orders = await q<{ name: string; is_prn: boolean; amount: string; times: string[] | null }>(
    `SELECT m.name, o.is_prn, o.dosage->>'amount' AS amount, o.schedule->'times' AS times
     FROM carecore_medication_orders o JOIN carecore_medications m ON m.id = o.medication_id
     WHERE o.resident_id = $1 ORDER BY o.is_prn, o.dosage->>'amount' DESC`,
    [erna],
  );
  assert.deepEqual(
    orders.map((row) => [row.name, row.is_prn, row.amount, row.times]),
    [
      ["Amlodipin", false, "1 STK", ["08:00"]],
      ["Amlodipin", false, "0,5 STK", ["18:00"]],
      ["Paracetamol 500 mg", true, "1 STK", null],
    ],
  );

  // Beim nächsten Plan ist die GTIN dem Präparat zugeordnet.
  draft = await readEmediplan(ctx, erna, plan("Muster"));
  assert.deepEqual(draft.lines[0].match, {
    id: draft.lines[0].match?.id,
    name: "Amlodipin",
    strength: "5 mg",
    form: "Tablette",
  });

  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_audit_log WHERE after_data->>'residentId' = $1 ORDER BY created_at`,
    [erna],
  );
  assert.equal(audit.filter((row) => row.action === "emediplan_read").length, 3);
  assert.equal(audit.filter((row) => row.action === "created").length, 3);
});
