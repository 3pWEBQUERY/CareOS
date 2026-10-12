import { test } from "node:test";
import assert from "node:assert/strict";
import { RosterError } from "@/lib/roster/errors";
import { periodAction } from "@/lib/roster/period-service";
import {
  createAbsence,
  createTimeOff,
  decideAbsence,
  decideTimeOff,
  savePreference,
  withdrawTimeOff,
} from "@/lib/roster/request-service";
import { getSchedule } from "@/lib/roster/schedule";
import { createShift } from "@/lib/roster/shift-service";
import { addDays, localDate, weekStart } from "@/lib/roster/time";
import { fixture, q } from "../support/db";

const code = (error: unknown) => (error instanceof RosterError ? error.code : String(error));
const expectCode = async (promise: Promise<unknown>, expected: string) =>
  assert.equal(await promise.then(() => "OK", code), expected);
// A Monday a few weeks ahead, so requests are always in the future.
const monday = weekStart(addDays(localDate(new Date(), "Europe/Zurich"), 21));

test("Wunschfrei: Antrag → Benachrichtigung → Entscheidung → Benachrichtigung", async () => {
  const f = await fixture();
  const anna = await f.ctx("anna");
  const lead = await f.ctx("leadA");
  const { id } = await createTimeOff(anna, { startDate: monday, priority: "HIGH", comment: "Familienfest" });
  const [requested] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_notifications WHERE user_id = $1 AND type = 'shift_time_off_requested'`,
    [f.people.leadA],
  );
  assert.equal(requested.n, 1);
  // Mitarbeitende und fremde Leitung entscheiden nicht.
  await expectCode(decideTimeOff(anna, id, { decision: "APPROVED" }), "FORBIDDEN");
  await expectCode(decideTimeOff(await f.ctx("leadB"), id, { decision: "APPROVED" }), "NOT_FOUND");
  await decideTimeOff(lead, id, { decision: "APPROVED", comment: "Gerne" });
  const [decided] = await q<{ status: string; n: number }>(
    `SELECT t.status, (SELECT COUNT(*)::int FROM carecore_notifications WHERE user_id = $2 AND type = 'shift_time_off_decided') AS n
     FROM carecore_time_off_requests t WHERE t.id = $1`,
    [id, f.people.anna],
  );
  assert.deepEqual(decided, { status: "APPROVED", n: 1 });
  // Genehmigtes Wunschfrei ist eine harte Regel.
  await expectCode(
    createShift(lead, { unitId: f.units.a, employeeId: f.people.anna, shiftTypeId: await f.type("F"), date: monday }),
    "RULE_VIOLATION",
  );
});

test("Wunschfrei mit bestehendem Dienst: Konflikt zeigen, dann 'Dienst entfernen und genehmigen'", async () => {
  const f = await fixture();
  const lead = await f.ctx("leadA");
  const max = await f.ctx("max");
  const day = addDays(monday, 1);
  const { shiftIds } = await createShift(lead, {
    unitId: f.units.a,
    employeeId: f.people.max,
    shiftTypeId: await f.type("F"),
    date: day,
  });
  const { id } = await createTimeOff(max, { startDate: day });
  const conflict = await decideTimeOff(lead, id, { decision: "APPROVED" }).catch((e: RosterError) => e);
  assert.ok(conflict instanceof RosterError);
  assert.equal(conflict.code, "HAS_SHIFTS");
  assert.match(conflict.message, /Frühdienst/);
  await decideTimeOff(lead, id, { decision: "APPROVED", removeShifts: true });
  assert.equal((await q(`SELECT 1 FROM carecore_roster_shifts WHERE id = $1`, [shiftIds[0]])).length, 0);
  const [audit] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_roster_audit WHERE entity_id = $1 AND action = 'deleted'`,
    [shiftIds[0]],
  );
  assert.equal(audit.n, 1);
});

test("Wunschfrei zurückziehen nur durch die antragstellende Person, solange offen", async () => {
  const f = await fixture();
  const lea = await f.ctx("lea");
  const { id } = await createTimeOff(lea, { startDate: addDays(monday, 2) });
  await expectCode(withdrawTimeOff(await f.ctx("anna"), id), "NOT_FOUND");
  await withdrawTimeOff(lea, id);
  await expectCode(withdrawTimeOff(lea, id), "INVALID");
});

test("Ferienantrag: Bewilligung erzeugt Urlaubsdienste Mo–Fr; Krankmeldung ersetzt eingeteilte Dienste", async () => {
  const f = await fixture();
  const lead = await f.ctx("leadA");
  const anna = await f.ctx("anna");
  const { created } = await createAbsence(anna, { kind: "vacation", startsOn: monday, endsOn: addDays(monday, 6) });
  assert.equal(created, 0);
  const [absence] = await q<{ id: string }>(`SELECT id FROM carecore_absences WHERE user_id = $1`, [f.people.anna]);
  const result = await decideAbsence(lead, absence.id, { decision: "APPROVED" });
  assert.equal((result as { created: number }).created, 5);
  const vacation = await q<{ date: string }>(
    `SELECT to_char(date, 'YYYY-MM-DD') AS date FROM carecore_roster_shifts WHERE employee_id = $1 AND category = 'ABSENCE' ORDER BY date`,
    [f.people.anna],
  );
  assert.deepEqual(
    vacation.map((v) => v.date),
    [0, 1, 2, 3, 4].map((i) => addDays(monday, i)),
  );

  // Krankmeldung: der eingeteilte Dienst am Montag darauf wird zu "Krank".
  const nextMonday = addDays(monday, 7);
  await createShift(lead, {
    unitId: f.units.a,
    employeeId: f.people.max,
    shiftTypeId: await f.type("S"),
    date: nextMonday,
  });
  const max = await f.ctx("max");
  await createAbsence(max, { kind: "sick", startsOn: nextMonday, endsOn: nextMonday });
  const rows = await q<{ code: string }>(
    `SELECT t.code FROM carecore_roster_shifts s JOIN carecore_shift_types t ON t.id = s.shift_type_id WHERE s.employee_id = $1 AND s.date = $2`,
    [f.people.max, nextMonday],
  );
  assert.deepEqual(rows, [{ code: "K" }]);
  const [alert] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_notifications WHERE user_id = $1 AND type = 'shift_staffing_problem'`,
    [f.people.leadA],
  );
  assert.equal(alert.n, 1);
});

test("Kolleg:innen sehen „Abwesend“ statt „Krank“, die Leitung sieht die Kategorie", async () => {
  const f = await fixture();
  const lead = await f.ctx("leadA");
  const day = addDays(monday, 2);
  await createShift(lead, { unitId: f.units.a, employeeId: f.people.anna, shiftTypeId: await f.type("F"), date: day });
  await createShift(lead, { unitId: f.units.a, employeeId: f.people.max, shiftTypeId: await f.type("K"), date: day });
  const [year, month] = [Number(day.slice(0, 4)), Number(day.slice(5, 7))];
  const plan = await getSchedule(lead, { unitId: f.units.a, year, month });
  await periodAction(lead, plan.period!.id, {
    action: "publish",
    expectedVersion: plan.period!.version,
    acknowledgedWarnings: ["MIN_STAFFING", "MIN_QUALIFIED", "MAX_WEEKLY_WORK", "MAX_CONSECUTIVE_DAYS"],
    overrideReason: "Test",
  });
  const colleague = await getSchedule(await f.ctx("anna"), { unitId: f.units.a, year, month });
  const sick = colleague.shifts.find((s) => s.employeeId === f.people.max)!;
  assert.equal(sick.name, "Abwesend");
  assert.equal(sick.masked, true);
  const leadView = await getSchedule(lead, { unitId: f.units.a, year, month });
  assert.equal(leadView.shifts.find((s) => s.employeeId === f.people.max)?.name, "Krank");
});

test("Dienstwunsch erfassen benachrichtigt die Leitung", async () => {
  const f = await fixture();
  await savePreference(await f.ctx("lea"), null, {
    kind: "AVOID_WEEKDAY",
    weekday: 5,
    comment: "Freitags Kinderbetreuung",
  });
  const [row] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_notifications WHERE user_id = $1 AND type = 'shift_preference_submitted'`,
    [f.people.leadA],
  );
  assert.equal(row.n, 1);
});
