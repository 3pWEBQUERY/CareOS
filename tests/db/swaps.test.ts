import { test } from "node:test";
import assert from "node:assert/strict";
import { RosterError } from "@/lib/roster/errors";
import { periodAction } from "@/lib/roster/period-service";
import { getSchedule } from "@/lib/roster/schedule";
import { commitChanges, createShift } from "@/lib/roster/shift-service";
import { createSwap, decideSwap, getSwapCandidates, respondToSwap } from "@/lib/roster/swap-service";
import { addDays, localDate } from "@/lib/roster/time";
import { fixture, q, type Fixture } from "../support/db";

const code = (error: unknown) => (error instanceof RosterError ? error.code : String(error));
const expectCode = async (promise: Promise<unknown>, expected: string) =>
  assert.equal(await promise.then(() => "OK", code), expected);
const ACK = {
  acknowledgedWarnings: ["MIN_STAFFING", "MIN_QUALIFIED", "MAX_WEEKLY_WORK", "MAX_CONSECUTIVE_DAYS"],
  overrideReason: "Test",
};
// A day in the next month: plannable, in the future, in its own period.
const today = localDate(new Date(), "Europe/Zurich");
const nextMonthDay = (day: number) => {
  const [y, m] = today.split("-").map(Number);
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

async function plan(f: Fixture, entries: Array<[string, string, string]>) {
  const lead = await f.ctx("leadA");
  const ids: string[] = [];
  for (const [person, type, date] of entries) {
    const { shiftIds } = await createShift(lead, {
      unitId: f.units.a,
      employeeId: f.people[person],
      shiftTypeId: await f.type(type),
      date,
      ...ACK,
    });
    ids.push(shiftIds[0]);
  }
  const date = entries[0][2];
  const schedule = await getSchedule(lead, {
    unitId: f.units.a,
    year: Number(date.slice(0, 4)),
    month: Number(date.slice(5, 7)),
  });
  if (schedule.period?.status !== "PUBLISHED")
    await periodAction(lead, schedule.period!.id, {
      action: "publish",
      expectedVersion: schedule.period!.version,
      ...ACK,
    });
  return ids;
}

test("gültiger Tausch Früh↔Spät am selben Tag wird atomar ausgeführt", async () => {
  const f = await fixture();
  const day = nextMonthDay(10);
  const [early, late] = await plan(f, [
    ["anna", "F", day],
    ["max", "S", day],
  ]);
  const anna = await f.ctx("anna");
  const { candidates } = await getSwapCandidates(anna, early);
  assert.ok(candidates.some((c) => c.employeeId === f.people.max && c.targetShiftId === late));
  // Kandidatensicht: nur Name und Gegendienst.
  assert.deepEqual(Object.keys(candidates[0]).sort(), [
    "employeeId",
    "name",
    "targetShift",
    "targetShiftId",
    "targetShiftVersion",
    "warnings",
  ]);
  const { id } = await createSwap(anna, { sourceShiftId: early, targetEmployeeId: f.people.max, targetShiftId: late });
  await q(`DELETE FROM carecore_notifications WHERE user_id = ANY($1::uuid[])`, [
    [f.people.anna, f.people.max, f.people.leadA],
  ]);
  const result = await respondToSwap(await f.ctx("max"), id, { accept: true });
  assert.equal(result.status, "EXECUTED");
  const shifts = await q<{ id: string; employee_id: string; source: string; last_swap_id: string }>(
    `SELECT id, employee_id, source, last_swap_id FROM carecore_roster_shifts WHERE id = ANY($1::uuid[])`,
    [[early, late]],
  );
  assert.equal(shifts.find((s) => s.id === early)?.employee_id, f.people.max);
  assert.equal(shifts.find((s) => s.id === late)?.employee_id, f.people.anna);
  assert.ok(shifts.every((s) => s.source === "SWAP" && s.last_swap_id === id));
  const audits = await q<{ correlation_id: string }>(
    `SELECT correlation_id FROM carecore_roster_audit WHERE entity_type = 'shift' AND action = 'swapped' AND entity_id = ANY($1::uuid[])`,
    [[early, late]],
  );
  assert.equal(audits.length, 2);
  assert.equal(audits[0].correlation_id, audits[1].correlation_id);
  const [notes] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_notifications WHERE type = 'shift_swap_executed' AND user_id = ANY($1::uuid[])`,
    [[f.people.anna, f.people.max, f.people.leadA]],
  );
  assert.equal(notes.n, 3);
});

test("Tausch mit Ruhezeitverstoss wird nicht angeboten und scheitert bei der Ausführung", async () => {
  const f = await fixture();
  const day = nextMonthDay(12);
  const [early, late] = await plan(f, [
    ["anna", "F", day],
    ["max", "S", day],
    ["anna", "F", addDays(day, 1)],
  ]);
  const anna = await f.ctx("anna");
  const { candidates } = await getSwapCandidates(anna, early);
  assert.ok(!candidates.some((c) => c.targetShiftId === late), "Spät vor Früh verletzt Annas Ruhezeit");
  await expectCode(
    createSwap(anna, { sourceShiftId: early, targetEmployeeId: f.people.max, targetShiftId: late }),
    "RULE_VIOLATION",
  );
});

test("fehlende Qualifikation, andere Wohngruppe und Dienst in der Vergangenheit", async () => {
  const f = await fixture();
  const day = nextMonthDay(14);
  const hf = (
    await q<{ id: string }>(`SELECT id FROM carecore_qualifications WHERE organization_id = $1 AND code = 'HF'`, [
      f.org,
    ])
  )[0].id;
  await q(
    `UPDATE carecore_shift_types SET required_qualification_ids = ARRAY[$1::uuid] WHERE organization_id = $2 AND code = 'N'`,
    [hf, f.org],
  );
  await q(`INSERT INTO carecore_employee_qualifications (user_id, qualification_id) VALUES ($1, $2)`, [
    f.people.anna,
    hf,
  ]);
  const [night, early] = await plan(f, [
    ["anna", "N", day],
    ["max", "F", addDays(day, 3)],
  ]);
  const anna = await f.ctx("anna");
  // Max hat keine HF-Qualifikation → Annas Nachtdienst geht nicht an Max.
  await expectCode(
    createSwap(anna, { sourceShiftId: night, targetEmployeeId: f.people.max, targetShiftId: early }),
    "RULE_VIOLATION",
  );
  // Ben arbeitet in Wohngruppe B.
  const { candidates } = await getSwapCandidates(anna, night);
  assert.ok(!candidates.some((c) => c.employeeId === f.people.ben));
  // Vergangener Dienst.
  await q(`UPDATE carecore_roster_shifts SET planned_start = NOW() - INTERVAL '1 hour' WHERE id = $1`, [night]);
  await expectCode(getSwapCandidates(anna, night), "INVALID");
});

test("inzwischen geänderter Dienst → EXPIRED", async () => {
  const f = await fixture();
  const day = nextMonthDay(16);
  const [early, late] = await plan(f, [
    ["anna", "F", day],
    ["max", "S", day],
  ]);
  const { id } = await createSwap(await f.ctx("anna"), {
    sourceShiftId: early,
    targetEmployeeId: f.people.max,
    targetShiftId: late,
  });
  await q(`UPDATE carecore_roster_shifts SET version = version + 1 WHERE id = $1`, [late]);
  await expectCode(respondToSwap(await f.ctx("max"), id, { accept: true }), "EXPIRED");
  const [row] = await q<{ status: string }>(`SELECT status FROM carecore_shift_swaps WHERE id = $1`, [id]);
  assert.equal(row.status, "EXPIRED");
});

test("zwei gleichzeitige Annahmen auf denselben Dienst: genau einer wird ausgeführt", async () => {
  const f = await fixture();
  const day = nextMonthDay(18);
  const [annaShift, maxShift, leaShift] = await plan(f, [
    ["anna", "F", day],
    ["max", "S", day],
    ["lea", "F", day],
  ]);
  const first = await createSwap(await f.ctx("anna"), {
    sourceShiftId: annaShift,
    targetEmployeeId: f.people.max,
    targetShiftId: maxShift,
  });
  // createSwap weist einen zweiten aktiven Tausch auf denselben Gegendienst ab; zwei nahezu
  // gleichzeitig gestellte Anfragen können trotzdem beide offen sein – daher direkt anlegen.
  const [second] = await q<{ id: string }>(
    `INSERT INTO carecore_shift_swaps (organization_id, care_unit_id, requester_id, target_employee_id,
       source_shift_id, target_shift_id, source_shift_version, target_shift_version)
     SELECT s.organization_id, s.care_unit_id, s.employee_id, t.employee_id, s.id, t.id, s.version, t.version
     FROM carecore_roster_shifts s, carecore_roster_shifts t WHERE s.id = $1 AND t.id = $2
     RETURNING id`,
    [leaShift, maxShift],
  );
  const max = await f.ctx("max");
  const results = await Promise.allSettled([
    respondToSwap(max, first.id, { accept: true }),
    respondToSwap(max, second.id, { accept: true }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const statuses = await q<{ status: string }>(
    `SELECT status FROM carecore_shift_swaps WHERE id = ANY($1::uuid[]) ORDER BY status`,
    [[first.id, second.id]],
  );
  assert.deepEqual(
    statuses.map((s) => s.status).filter((s) => s === "EXECUTED"),
    ["EXECUTED"],
  );
  const [owner] = await q<{ employee_id: string }>(`SELECT employee_id FROM carecore_roster_shifts WHERE id = $1`, [
    maxShift,
  ]);
  assert.ok([f.people.anna, f.people.lea].includes(owner.employee_id));
});

test("ohne automatische Genehmigung: PENDING_APPROVAL, erst die Leitung führt aus", async () => {
  const f = await fixture();
  await q(`UPDATE carecore_rule_sets SET auto_swap_approval = FALSE WHERE organization_id = $1`, [f.org]);
  const day = nextMonthDay(20);
  const [early, late] = await plan(f, [
    ["anna", "F", day],
    ["max", "S", day],
  ]);
  const { id } = await createSwap(await f.ctx("anna"), {
    sourceShiftId: early,
    targetEmployeeId: f.people.max,
    targetShiftId: late,
  });
  assert.equal((await respondToSwap(await f.ctx("max"), id, { accept: true })).status, "PENDING_APPROVAL");
  assert.equal(
    (await q<{ employee_id: string }>(`SELECT employee_id FROM carecore_roster_shifts WHERE id = $1`, [early]))[0]
      .employee_id,
    f.people.anna,
  );
  await expectCode(decideSwap(await f.ctx("anna"), id, { action: "approve" }), "FORBIDDEN");
  assert.equal((await decideSwap(await f.ctx("leadA"), id, { action: "approve" })).status, "EXECUTED");
  assert.equal(
    (await q<{ employee_id: string }>(`SELECT employee_id FROM carecore_roster_shifts WHERE id = $1`, [early]))[0]
      .employee_id,
    f.people.max,
  );
});

test("Fehler nach dem ersten Update → Rollback, kein Dienst verändert", async () => {
  const f = await fixture();
  const day = nextMonthDay(22);
  const [early, late] = await plan(f, [
    ["anna", "F", day],
    ["max", "S", day],
  ]);
  const lead = await f.ctx("leadA");
  await assert.rejects(
    commitChanges(lead, {
      unitId: f.units.a,
      acknowledged: [],
      reason: null,
      source: "SWAP",
      changes: [
        {
          kind: "swap",
          sourceShiftId: early,
          sourceVersion: 1,
          targetEmployeeId: f.people.max,
          targetShiftId: late,
          targetVersion: 1,
        },
      ],
      // Simulierter Fehler nach den Updates, noch in derselben Transaktion.
      extra: () => [lead.sql`SELECT carecore_assert(FALSE, 'SIMULATED')`],
    }),
  );
  const rows = await q<{ id: string; employee_id: string; version: number }>(
    `SELECT id, employee_id, version FROM carecore_roster_shifts WHERE id = ANY($1::uuid[])`,
    [[early, late]],
  );
  assert.equal(rows.find((r) => r.id === early)?.employee_id, f.people.anna);
  assert.equal(rows.find((r) => r.id === late)?.employee_id, f.people.max);
  assert.ok(rows.every((r) => r.version === 1));
});

test("Mitarbeitende:r ändert fremden Dienst über den Tausch nicht", async () => {
  const f = await fixture();
  const day = nextMonthDay(24);
  const [maxShift] = await plan(f, [["max", "F", day]]);
  await expectCode(getSwapCandidates(await f.ctx("anna"), maxShift), "NOT_FOUND");
  await expectCode(
    createSwap(await f.ctx("anna"), { sourceShiftId: maxShift, targetEmployeeId: f.people.anna }),
    "NOT_FOUND",
  );
});
