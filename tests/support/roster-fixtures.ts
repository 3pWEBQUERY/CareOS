// Test-Doubles für die Regel-Engine: Regelwerk, Diensttypen, Personen und Dienste.
import { plannedInterval } from "@/lib/roster/time";
import type {
  EmployeeInfo,
  PeriodInfo,
  RosterShift,
  RuleSet,
  ScheduleSnapshot,
  ShiftTypeInfo,
} from "@/lib/roster/types";

export const TZ = "Europe/Zurich";
export const UNIT = "unit-a";

export function ruleSet(overrides: Partial<RuleSet> = {}): RuleSet {
  return {
    id: "rules",
    careUnitId: null,
    timezone: TZ,
    weeklyNormMinutes: 2520,
    minRestMinutes: 660,
    maxDailyWorkMinutes: 600,
    maxWeeklyWorkMinutes: 3000,
    maxConsecutiveWorkDays: 6,
    breakRules: [
      { minWorkMinutes: 330, minBreakMinutes: 15 },
      { minWorkMinutes: 420, minBreakMinutes: 30 },
      { minWorkMinutes: 540, minBreakMinutes: 60 },
    ],
    nightStart: "23:00",
    nightEnd: "06:00",
    deviationThresholdMinutes: 30,
    missingClockOutAfterMinutes: 120,
    clockInEarliestMinutes: 60,
    autoSwapApproval: true,
    allowShiftTakeover: false,
    aiRunsPerHour: 10,
    valuesConfirmed: false,
    ...overrides,
  };
}

const type = (
  id: string,
  name: string,
  startTime: string,
  endTime: string,
  extra: Partial<ShiftTypeInfo> = {},
): ShiftTypeInfo => ({
  id,
  careUnitId: null,
  name,
  code: id,
  category: "WORK",
  absenceKind: null,
  startTime,
  endTime,
  breakMinutes: 30,
  color: "#2563eb",
  workTimeFactor: 1,
  creditsTarget: false,
  requiredQualificationIds: [],
  active: true,
  sortOrder: 0,
  ...extra,
});

export function shiftTypes(): Record<string, ShiftTypeInfo> {
  return Object.fromEntries(
    [
      type("F", "Frühdienst", "06:30", "15:00"),
      type("S", "Spätdienst", "13:30", "22:00"),
      type("N", "Nachtdienst", "21:45", "07:00", { requiredQualificationIds: ["q-hf"] }),
      type("L", "Langer Dienst", "06:00", "17:30"),
      type("R", "Rufbereitschaft", "19:00", "07:00", { category: "ON_CALL", breakMinutes: 0, workTimeFactor: 0 }),
      type("U", "Urlaub", "08:00", "16:24", {
        category: "ABSENCE",
        absenceKind: "VACATION",
        breakMinutes: 0,
        creditsTarget: true,
      }),
      type("K", "Krank", "08:00", "16:24", {
        category: "ABSENCE",
        absenceKind: "SICK",
        breakMinutes: 0,
        creditsTarget: true,
      }),
    ].map((t) => [t.id, t]),
  );
}

export function employee(id: string, overrides: Partial<EmployeeInfo> = {}): EmployeeInfo {
  return {
    id,
    name: { e1: "Anna Müller", e2: "Max Meier", e3: "Lea Beispiel", e4: "Tom Keller" }[id] ?? id,
    pensumPercent: 100,
    weeklyTargetMinutesOverride: null,
    employmentStart: null,
    employmentEnd: null,
    active: true,
    excludedCategories: [],
    unitIds: [UNIT],
    qualifications: [],
    ...overrides,
  };
}

export function shift(
  input: Partial<RosterShift> & { id: string; employeeId: string; shiftTypeId: string; date: string },
): RosterShift {
  const t = shiftTypes()[input.shiftTypeId];
  const { start, end } = plannedInterval(input.date, t.startTime, t.endTime, TZ);
  return {
    periodId: `period-${input.date.slice(0, 7)}`,
    unitId: UNIT,
    category: t.category,
    plannedStart: start.toISOString(),
    plannedEnd: end.toISOString(),
    breakMinutes: t.breakMinutes,
    source: "SEED",
    notes: null,
    lastSwapId: null,
    version: 1,
    hasTimeEntry: false,
    ...input,
  };
}

export function periods(): PeriodInfo[] {
  return ["2026-09", "2026-10", "2026-11"].map((key) => ({
    id: `period-${key}`,
    unitId: UNIT,
    year: Number(key.slice(0, 4)),
    month: Number(key.slice(5, 7)),
    status: "DRAFT",
    lockedAt: null,
    version: 1,
  }));
}

export function snapshot(overrides: Partial<ScheduleSnapshot> = {}): ScheduleSnapshot {
  return {
    unitId: UNIT,
    ruleSet: ruleSet(),
    now: "2026-10-01T08:00:00.000Z",
    periods: periods(),
    shifts: [],
    employees: Object.fromEntries(["e1", "e2", "e3", "e4"].map((id) => [id, employee(id)])),
    shiftTypes: shiftTypes(),
    staffing: [],
    timeOff: [],
    preferences: [],
    holidays: [],
    qualificationNames: { "q-hf": "Pflegefachperson HF" },
    managedUnitIds: [UNIT],
    ...overrides,
  };
}
