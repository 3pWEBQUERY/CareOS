// Soll/Ist-Berechnung (Spec 8.9, 8.10). Reine Funktionen.
// Tagessoll = Wochennorm × Pensum / 100 / 5; Monatssoll = Tagessoll × Werktage (Mo–Fr) ohne Feiertage
// im Anstellungszeitraum. Abwesenheiten mit Anrechnung zählen mit dem Tagessoll.
import { dayMinutes, isWeekend, monthDays, netMinutes, requiredBreak, weekday, windowMinutes } from "./time";
import type { AbsenceKind, EmployeeInfo, RosterShift, RuleSet, ShiftTypeInfo, TimeEntryStatus } from "./types";

export function dailyTargetMinutes(
  weeklyNormMinutes: number,
  employee: Pick<EmployeeInfo, "pensumPercent" | "weeklyTargetMinutesOverride">,
) {
  const weekly = employee.weeklyTargetMinutesOverride ?? (weeklyNormMinutes * employee.pensumPercent) / 100;
  return Math.round(weekly / 5);
}

const employedOn = (employee: Pick<EmployeeInfo, "employmentStart" | "employmentEnd">, date: string) =>
  (!employee.employmentStart || employee.employmentStart <= date) &&
  (!employee.employmentEnd || employee.employmentEnd >= date);

// Werktage (Mo–Fr, ohne Feiertage) im Monat, an denen die Person angestellt ist.
export function targetWorkdays(
  employee: Pick<EmployeeInfo, "employmentStart" | "employmentEnd">,
  year: number,
  month: number,
  holidays: string[],
) {
  const set = new Set(holidays);
  return monthDays(year, month).filter((date) => weekday(date) <= 5 && !set.has(date) && employedOn(employee, date));
}

export function targetMinutesForMonth(
  rules: Pick<RuleSet, "weeklyNormMinutes">,
  employee: EmployeeInfo,
  year: number,
  month: number,
  holidays: string[],
) {
  return dailyTargetMinutes(rules.weeklyNormMinutes, employee) * targetWorkdays(employee, year, month, holidays).length;
}

export type TimeEntryInfo = {
  id: string;
  employeeId: string;
  shiftId: string | null;
  date: string;
  clockIn: string;
  clockOut: string | null;
  breakMinutes: number;
  actualMinutes: number | null;
  status: TimeEntryStatus;
  version?: number;
};

// Server-side only: never trust a value sent by the client.
export const computeActualMinutes = (clockIn: string, clockOut: string, breakMinutes: number) =>
  netMinutes(clockIn, clockOut, breakMinutes);

// Pause unter der gesetzlichen Staffel wird markiert, nicht still korrigiert.
export function breakShortfall(entry: Pick<TimeEntryInfo, "clockIn" | "clockOut" | "breakMinutes">, rules: RuleSet) {
  if (!entry.clockOut) return 0;
  const work = netMinutes(entry.clockIn, entry.clockOut, entry.breakMinutes);
  return Math.max(requiredBreak(work, rules.breakRules) - entry.breakMinutes, 0);
}

// Kein Clock-out bis "missingClockOutAfterMinutes" nach Dienstende (ohne Dienst: nach 16 h).
export function clockOutMissing(
  entry: Pick<TimeEntryInfo, "clockIn" | "clockOut" | "status">,
  plannedEnd: string | null,
  rules: RuleSet,
  now: string,
) {
  if (entry.clockOut || entry.status !== "OPEN") return false;
  const deadline = plannedEnd
    ? Date.parse(plannedEnd) + rules.missingClockOutAfterMinutes * 60_000
    : Date.parse(entry.clockIn) + 16 * 3_600_000;
  return Date.parse(now) > deadline;
}

export type WorkTimeSummary = {
  employeeId: string;
  targetMinutes: number;
  // Soll bis einschliesslich "today" (laufender Monat); Grundlage für den Saldo.
  targetToDateMinutes: number;
  plannedMinutes: number;
  actualMinutes: number;
  balanceMinutes: number;
  nightMinutes: number;
  weekendMinutes: number;
  holidayMinutes: number;
  absenceDays: Record<AbsenceKind, number>;
  notRecorded: number;
  incomplete: number;
};

export function summarizeMonth(input: {
  rules: RuleSet;
  employee: EmployeeInfo;
  year: number;
  month: number;
  holidays: string[];
  shifts: RosterShift[];
  entries: TimeEntryInfo[];
  types: Record<string, ShiftTypeInfo>;
  now: string;
  today: string;
}): WorkTimeSummary {
  const { rules, employee, year, month, holidays, types, now, today } = input;
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  const shifts = input.shifts.filter((shift) => shift.employeeId === employee.id && shift.date.startsWith(prefix));
  const entries = input.entries.filter((entry) => entry.employeeId === employee.id && entry.date.startsWith(prefix));
  const holidaySet = new Set(holidays);
  const daily = dailyTargetMinutes(rules.weeklyNormMinutes, employee);
  const credited = (shift: RosterShift) =>
    types[shift.shiftTypeId]?.creditsTarget && weekday(shift.date) <= 5 && !holidaySet.has(shift.date) ? daily : 0;
  const factor = (shiftId: string | null) => {
    const shift = shiftId ? shifts.find((s) => s.id === shiftId) : null;
    return shift ? (types[shift.shiftTypeId]?.workTimeFactor ?? 1) : 1;
  };

  const absenceDays: Record<AbsenceKind, number> = { VACATION: 0, SICK: 0, TRAINING: 0, OTHER: 0 };
  let planned = 0;
  let absenceCredit = 0;
  for (const shift of shifts) {
    if (shift.category === "ABSENCE") {
      const kind = types[shift.shiftTypeId]?.absenceKind ?? "OTHER";
      absenceDays[kind] += 1;
      planned += credited(shift);
      if (shift.date <= today) absenceCredit += credited(shift);
    } else
      planned += Math.round(
        netMinutes(shift.plannedStart, shift.plannedEnd, shift.breakMinutes) *
          (types[shift.shiftTypeId]?.workTimeFactor ?? 1),
      );
  }

  let actual = absenceCredit;
  let night = 0;
  let weekend = 0;
  let holiday = 0;
  for (const entry of entries) {
    if (!entry.clockOut || entry.actualMinutes === null) continue;
    actual += Math.round(entry.actualMinutes * factor(entry.shiftId));
    night += windowMinutes(entry.clockIn, entry.clockOut, rules.nightStart, rules.nightEnd, rules.timezone);
    weekend += dayMinutes(entry.clockIn, entry.clockOut, isWeekend, rules.timezone);
    holiday += dayMinutes(entry.clockIn, entry.clockOut, (date) => holidaySet.has(date), rules.timezone);
  }

  const recorded = new Set(entries.map((entry) => entry.shiftId).filter(Boolean));
  const notRecorded = shifts.filter(
    (shift) =>
      shift.category !== "ABSENCE" && Date.parse(shift.plannedEnd) < Date.parse(now) && !recorded.has(shift.id),
  ).length;
  const target = targetMinutesForMonth(rules, employee, year, month, holidays);
  const targetToDate =
    dailyTargetMinutes(rules.weeklyNormMinutes, employee) *
    targetWorkdays(employee, year, month, holidays).filter((date) => date <= today).length;

  return {
    employeeId: employee.id,
    targetMinutes: target,
    targetToDateMinutes: targetToDate,
    plannedMinutes: planned,
    actualMinutes: actual,
    // Über-/Minusstunden bis heute; in vergangenen Monaten entspricht das dem vollen Soll.
    balanceMinutes: actual - targetToDate,
    nightMinutes: night,
    weekendMinutes: weekend,
    holidayMinutes: holiday,
    absenceDays,
    notRecorded,
    incomplete: entries.filter((entry) => entry.status === "INCOMPLETE").length,
  };
}
