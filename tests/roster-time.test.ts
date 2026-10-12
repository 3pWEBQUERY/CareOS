import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deviation,
  holidayMinutes,
  isoWeek,
  localDate,
  minutesBetween,
  netMinutes,
  plannedInterval,
  requiredBreak,
  weekendMinutes,
  windowMinutes,
  zonedToUtc,
} from "@/lib/roster/time";
import { breakShortfall, clockOutMissing, summarizeMonth, targetMinutesForMonth } from "@/lib/roster/worktime";
import { employee, ruleSet, shift, shiftTypes } from "./support/roster-fixtures";

const TZ = "Europe/Zurich";

test("Soll 06:30–15:00 mit 30 Min Pause = 480 Min", () => {
  const { start, end } = plannedInterval("2026-10-12", "06:30", "15:00", TZ);
  assert.equal(netMinutes(start, end, 30), 480);
});

test("Ist 06:42–15:18 mit 30 Min Pause: 486 Min, Differenz +6, Beginn +12, Ende +18", () => {
  const planned = plannedInterval("2026-10-12", "06:30", "15:00", TZ);
  const result = deviation(
    { start: planned.start, end: planned.end, breakMinutes: 30 },
    {
      clockIn: zonedToUtc("2026-10-12", "06:42", TZ),
      clockOut: zonedToUtc("2026-10-12", "15:18", TZ),
      breakMinutes: 30,
    },
  );
  assert.deepEqual(result, {
    plannedMinutes: 480,
    actualMinutes: 486,
    differenceMinutes: 6,
    startDeviationMinutes: 12,
    endDeviationMinutes: 18,
  });
});

test("negative Differenz bei früherem Dienstende", () => {
  const planned = plannedInterval("2026-10-12", "06:30", "15:00", TZ);
  const result = deviation(
    { start: planned.start, end: planned.end, breakMinutes: 30 },
    {
      clockIn: zonedToUtc("2026-10-12", "06:30", TZ),
      clockOut: zonedToUtc("2026-10-12", "14:00", TZ),
      breakMinutes: 30,
    },
  );
  assert.equal(result.differenceMinutes, -60);
  assert.equal(result.endDeviationMinutes, -60);
});

test("Nachtdienst über die Zeitumstellung: 495 Min im März, 615 Min im Oktober", () => {
  const march = plannedInterval("2026-03-28", "21:45", "07:00", TZ);
  assert.equal(minutesBetween(march.start, march.end), 495);
  const october = plannedInterval("2026-10-24", "21:45", "07:00", TZ);
  assert.equal(minutesBetween(october.start, october.end), 615);
  // Der Dienst gehört zum Starttag.
  assert.equal(localDate(october.start, TZ), "2026-10-24");
  assert.equal(localDate(october.end, TZ), "2026-10-25");
});

test("Nachtstunden eines Dienstes über Mitternacht", () => {
  const { start, end } = plannedInterval("2026-10-10", "21:45", "07:00", TZ);
  assert.equal(windowMinutes(start, end, "23:00", "06:00", TZ), 420);
  const late = plannedInterval("2026-10-10", "13:30", "22:00", TZ);
  assert.equal(windowMinutes(late.start, late.end, "23:00", "06:00", TZ), 0);
});

test("Wochenend- und Feiertagsminuten werden minutengenau aufgeteilt", () => {
  // Freitag 21:45 bis Samstag 07:00: 7 h am Samstag.
  const { start, end } = plannedInterval("2026-10-09", "21:45", "07:00", TZ);
  assert.equal(weekendMinutes(start, end, TZ), 420);
  const christmas = plannedInterval("2026-12-24", "21:45", "07:00", TZ);
  assert.equal(holidayMinutes(christmas.start, christmas.end, ["2026-12-25"], TZ), 420);
});

test("Pausenstaffel: mehr als 5½ / 7 / 9 Stunden", () => {
  const rules = ruleSet().breakRules;
  assert.equal(requiredBreak(330, rules), 0);
  assert.equal(requiredBreak(331, rules), 15);
  assert.equal(requiredBreak(480, rules), 30);
  assert.equal(requiredBreak(600, rules), 60);
});

test("Pause unter der Staffel wird markiert", () => {
  const rules = ruleSet();
  const entry = {
    clockIn: zonedToUtc("2026-10-12", "06:30", TZ).toISOString(),
    clockOut: zonedToUtc("2026-10-12", "15:00", TZ).toISOString(),
    breakMinutes: 10,
  };
  assert.equal(breakShortfall(entry, rules), 20);
  assert.equal(breakShortfall({ ...entry, breakMinutes: 30 }, rules), 0);
});

test("fehlender Clock-out: Warnung erst nach der Frist, ohne Ist-Minuten", () => {
  const rules = ruleSet();
  const plannedEnd = zonedToUtc("2026-10-12", "15:00", TZ).toISOString();
  const entry = {
    clockIn: zonedToUtc("2026-10-12", "06:30", TZ).toISOString(),
    clockOut: null,
    status: "OPEN" as const,
  };
  assert.equal(clockOutMissing(entry, plannedEnd, rules, zonedToUtc("2026-10-12", "16:30", TZ).toISOString()), false);
  assert.equal(clockOutMissing(entry, plannedEnd, rules, zonedToUtc("2026-10-12", "17:01", TZ).toISOString()), true);
});

test("Monatssoll mit Pensum 80 %, Feiertag und Urlaubstag", () => {
  const rules = ruleSet();
  const person = employee("e1", { pensumPercent: 80 });
  // Oktober 2026: 22 Werktage, davon einer als Feiertag gepflegt.
  const target = targetMinutesForMonth(rules, person, 2026, 10, ["2026-10-15"]);
  assert.equal(target, 403 * 21);
  const types = shiftTypes();
  const vacation = shift({ id: "u1", employeeId: "e1", shiftTypeId: "U", date: "2026-10-05" });
  const summary = summarizeMonth({
    rules,
    employee: person,
    year: 2026,
    month: 10,
    holidays: ["2026-10-15"],
    shifts: [vacation],
    entries: [],
    types,
    now: "2026-11-01T00:00:00.000Z",
    today: "2026-10-31",
  });
  assert.equal(summary.targetMinutes, 403 * 21);
  assert.equal(summary.actualMinutes, 403);
  assert.equal(summary.absenceDays.VACATION, 1);
  assert.equal(summary.balanceMinutes, 403 - 403 * 21);

  // Laufender Monat: Saldo gegen das Soll bis heute (Do 01.–Fr 09.10. = 7 Soll-Tage).
  const running = summarizeMonth({
    rules,
    employee: person,
    year: 2026,
    month: 10,
    holidays: ["2026-10-15"],
    shifts: [vacation],
    entries: [],
    types,
    now: "2026-10-09T18:00:00.000Z",
    today: "2026-10-09",
  });
  assert.equal(running.targetMinutes, 403 * 21);
  assert.equal(running.targetToDateMinutes, 403 * 7);
  assert.equal(running.balanceMinutes, 403 - 403 * 7);
});

test("Kalenderwochen", () => {
  assert.deepEqual(isoWeek("2026-10-12"), { year: 2026, week: 42 });
  assert.deepEqual(isoWeek("2027-01-01"), { year: 2026, week: 53 });
});
