import { test } from "node:test";
import assert from "node:assert/strict";
import { RosterError } from "@/lib/roster/errors";
import { decideInterest, listOpenShifts, registerInterest, withdrawInterest } from "@/lib/roster/open-shift-service";
import { periodAction } from "@/lib/roster/period-service";
import { getSchedule } from "@/lib/roster/schedule";
import { createShift } from "@/lib/roster/shift-service";
import { localDate } from "@/lib/roster/time";
import { fixture, q, type Fixture } from "../support/db";

const code = (error: unknown) => (error instanceof RosterError ? error.code : String(error));
const expectCode = async (promise: Promise<unknown>, expected: string) =>
  assert.equal(await promise.then(() => "OK", code), expected);
const ACK = {
  acknowledgedWarnings: ["MIN_STAFFING", "MIN_QUALIFIED", "MAX_WEEKLY_WORK", "MAX_CONSECUTIVE_DAYS"],
  overrideReason: "Test",
};
const today = localDate(new Date(), "Europe/Zurich");
const nextMonthDay = (day: number) => {
  const [y, m] = today.split("-").map(Number);
  const year = m === 12 ? y + 1 : y;
  const month = m === 12 ? 1 : m + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

// Wohnbereich A braucht am Tag zwei Frühdienste, eingeteilt ist Anna: ein Dienst ist offen, sobald veröffentlicht.
async function setup(f: Fixture, day: string, publish = true) {
  const lead = await f.ctx("leadA");
  const early = await f.type("F");
  await q(
    `INSERT INTO carecore_staffing_requirements (care_unit_id, shift_type_id, date, min_count) VALUES ($1, $2, $3, 2)`,
    [f.units.a, early, day],
  );
  await createShift(lead, { unitId: f.units.a, employeeId: f.people.anna, shiftTypeId: early, date: day, ...ACK });
  if (publish) {
    const schedule = await getSchedule(lead, {
      unitId: f.units.a,
      year: Number(day.slice(0, 4)),
      month: Number(day.slice(5, 7)),
    });
    await periodAction(lead, schedule.period!.id, {
      action: "publish",
      expectedVersion: schedule.period!.version,
      ...ACK,
    });
  }
  return { lead, early };
}

const slot = (f: Fixture, early: string, day: string) => ({ unitId: f.units.a, shiftTypeId: early, date: day });

test("Offene Dienste: nur im veröffentlichten Plan, nur für Mitarbeitende des Wohnbereichs", async () => {
  const f = await fixture();
  const day = nextMonthDay(12);
  const { early } = await setup(f, day, false);
  const max = await f.ctx("max");
  assert.equal((await listOpenShifts(max, { own: true })).shifts.length, 0, "Entwurf: nichts offen");
  await expectCode(registerInterest(max, slot(f, early, day)), "NOT_OPEN");

  const lead = await f.ctx("leadA");
  const schedule = await getSchedule(lead, {
    unitId: f.units.a,
    year: Number(day.slice(0, 4)),
    month: Number(day.slice(5, 7)),
  });
  await periodAction(lead, schedule.period!.id, {
    action: "publish",
    expectedVersion: schedule.period!.version,
    ...ACK,
  });
  const open = (await listOpenShifts(max, { own: true })).shifts.filter((s) => s.date === day);
  assert.equal(open.length, 1);
  assert.equal(open[0].open, 1);
  assert.equal(open[0].code, "F");
  assert.equal(open[0].interests.length, 0, "Mitarbeitende sehen keine fremden Interessen");
  // Anna ist an dem Tag schon eingeteilt.
  const anna = (await listOpenShifts(await f.ctx("anna"), { own: true })).shifts.find((s) => s.date === day);
  assert.equal(anna?.hasShiftThatDay, true);
  // Ben arbeitet nur in Wohnbereich B: sieht den Dienst nicht und darf kein Interesse melden.
  const ben = await f.ctx("ben");
  assert.equal((await listOpenShifts(ben, { own: true })).shifts.filter((s) => s.unitId === f.units.a).length, 0);
  await expectCode(registerInterest(ben, slot(f, early, day)), "NOT_FOUND");
});

test("Offene Dienste: Interesse, Zuteilung über die Regelprüfung, übrige werden geschlossen", async () => {
  const f = await fixture();
  const day = nextMonthDay(14);
  const { lead, early } = await setup(f, day);
  const max = await f.ctx("max");
  const lea = await f.ctx("lea");

  const { id: maxInterest } = await registerInterest(max, { ...slot(f, early, day), message: "Gerne" });
  await expectCode(registerInterest(max, slot(f, early, day)), "DUPLICATE");
  const { id: leaInterest } = await registerInterest(lea, slot(f, early, day));
  const [notified] = await q<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM carecore_notifications WHERE user_id = $1 AND type = 'shift_open_shift_interest'`,
    [f.people.leadA],
  );
  assert.equal(notified.n, 2, "Leitung wird je Interesse benachrichtigt");

  const leadView = (await listOpenShifts(lead, { own: false })).shifts.find((s) => s.date === day)!;
  assert.deepEqual(
    leadView.interests.map((i) => [i.employee, i.message]),
    [
      ["Max Meier", "Gerne"],
      ["Lea Beispiel", null],
    ],
  );
  // Nur die Leitung teilt zu; Mitarbeitende dürfen es nicht.
  await expectCode(decideInterest(max, maxInterest, { decision: "ASSIGNED" }), "FORBIDDEN");
  await expectCode(withdrawInterest(lea, maxInterest), "FORBIDDEN");

  const result = await decideInterest(lead, maxInterest, { decision: "ASSIGNED", comment: "Danke", ...ACK });
  assert.equal(result.status, "ASSIGNED");
  const [shift] = await q<{ employee_id: string; date: string }>(
    `SELECT employee_id, to_char(date, 'YYYY-MM-DD') AS date FROM carecore_roster_shifts WHERE id = $1`,
    [result.shiftId],
  );
  assert.deepEqual(shift, { employee_id: f.people.max, date: day });
  const statuses = await q<{ id: string; status: string }>(
    `SELECT id, status FROM carecore_open_shift_interests WHERE id = ANY($1::uuid[])`,
    [[maxInterest, leaInterest]],
  );
  assert.deepEqual(Object.fromEntries(statuses.map((s) => [s.id === maxInterest ? "max" : "lea", s.status])), {
    max: "ASSIGNED",
    lea: "CLOSED",
  });
  const leaNotes = await q<{ type: string }>(`SELECT type FROM carecore_notifications WHERE user_id = $1`, [
    f.people.lea,
  ]);
  assert.ok(leaNotes.some((n) => n.type === "shift_open_shift_closed"));
  const maxNotes = await q<{ type: string }>(`SELECT type FROM carecore_notifications WHERE user_id = $1`, [
    f.people.max,
  ]);
  assert.ok(
    maxNotes.some((n) => n.type === "shift_shift_changed"),
    "neuer Dienst wird gemeldet",
  );

  // Jetzt besetzt: nicht mehr offen, kein neues Interesse, keine zweite Zuteilung.
  assert.equal((await listOpenShifts(lea, { own: true })).shifts.filter((s) => s.date === day).length, 0);
  await expectCode(registerInterest(lea, slot(f, early, day)), "NOT_OPEN");
  await expectCode(decideInterest(lead, leaInterest, { decision: "ASSIGNED", ...ACK }), "NOT_OPEN");
  const audit = await q<{ action: string }>(
    `SELECT action FROM carecore_roster_audit WHERE entity_type = 'open_shift_interest' AND entity_id = $1 ORDER BY created_at`,
    [maxInterest],
  );
  assert.deepEqual(
    audit.map((a) => a.action),
    ["open_shift_interest", "open_shift_assigned"],
  );
});

test("Offene Dienste: zurückziehen und ablehnen mit Kommentar; Regelverstoss verhindert die Zuteilung", async () => {
  const f = await fixture();
  const day = nextMonthDay(16);
  const { lead, early } = await setup(f, day);
  const max = await f.ctx("max");
  const { id } = await registerInterest(max, slot(f, early, day));
  await withdrawInterest(max, id);
  await expectCode(withdrawInterest(max, id), "NOT_OPEN");

  const { id: second } = await registerInterest(max, slot(f, early, day));
  await decideInterest(lead, second, { decision: "DECLINED", comment: "Bereits zu viele Stunden" });
  const [declined] = await q<{ status: string; decision_comment: string }>(
    `SELECT status, decision_comment FROM carecore_open_shift_interests WHERE id = $1`,
    [second],
  );
  assert.deepEqual(declined, { status: "DECLINED", decision_comment: "Bereits zu viele Stunden" });

  // Sam hat am Vorabend einen Nachtdienst: die Ruhezeit-Regel blockiert die Zuteilung, nichts wird geschrieben.
  const night = await f.type("N");
  const previousDay = `${day.slice(0, 8)}${String(Number(day.slice(8)) - 1).padStart(2, "0")}`;
  await createShift(lead, {
    unitId: f.units.a,
    employeeId: f.people.sam,
    shiftTypeId: night,
    date: previousDay,
    ...ACK,
  });
  const sam = await f.ctx("sam");
  const { id: samInterest } = await registerInterest(sam, slot(f, early, day));
  await expectCode(decideInterest(lead, samInterest, { decision: "ASSIGNED", ...ACK }), "RULE_VIOLATION");
  const [still] = await q<{ status: string }>(`SELECT status FROM carecore_open_shift_interests WHERE id = $1`, [
    samInterest,
  ]);
  assert.equal(still.status, "OPEN");
});
