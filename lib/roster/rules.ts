// Regel-Engine des Dienstplans (Spec Abschnitt 7): reine, synchrone Funktionen ohne Datenbank.
// Manuelles Bearbeiten, Drag & Drop, Tauschpartner-Suche, Tausch, KI und Veröffentlichung nutzen
// dieselben Funktionen.
import {
  addDays,
  daysBetween,
  formatDate,
  formatHours,
  isWeekend,
  isoWeek,
  localDate,
  localTime,
  minutesBetween,
  monthLabel,
  netMinutes,
  plannedInterval,
  weekday,
  windowMinutes,
  zonedToUtc,
} from "./time";
import { dailyTargetMinutes, targetMinutesForMonth } from "./worktime";
import {
  EXCLUSION_LABELS,
  WEEKDAY_LABELS,
  type EmployeeInfo,
  type RosterShift,
  type RuleCode,
  type ScheduleSnapshot,
  type Severity,
  type ShiftChange,
  type ShiftPreference,
  type ShiftTypeInfo,
  type StaffingRequirement,
  type Violation,
} from "./types";

const SEVERITY: Record<RuleCode, Severity> = {
  OUT_OF_SCOPE: "BLOCK",
  EMPLOYEE_INACTIVE: "BLOCK",
  OVERLAP: "BLOCK",
  ABSENCE_CONFLICT: "BLOCK",
  APPROVED_TIME_OFF: "BLOCK",
  REST_TIME: "BLOCK",
  QUALIFICATION_MISSING: "BLOCK",
  EXCLUDED_CATEGORY: "BLOCK",
  MAX_DAILY_WORK: "BLOCK",
  PERIOD_LOCKED: "BLOCK",
  SHIFT_HAS_TIME_ENTRY: "BLOCK",
  STALE_VERSION: "BLOCK",
  SWAP_NOT_ALLOWED: "BLOCK",
  MAX_WEEKLY_WORK: "WARN",
  MAX_CONSECUTIVE_DAYS: "WARN",
  MIN_STAFFING: "WARN",
  MIN_QUALIFIED: "WARN",
  MAX_STAFFING: "INFO",
  OPEN_TIME_OFF_IGNORED: "INFO",
  PREFERENCE_IGNORED: "INFO",
  TARGET_DEVIATION: "INFO",
  UNEVEN_DISTRIBUTION: "INFO",
};

export const blocking = (violations: Violation[]) => violations.filter((v) => v.severity === "BLOCK");
export const warnings = (violations: Violation[]) => violations.filter((v) => v.severity === "WARN");

// Warnings the user still has to confirm (with a reason) before the change is written.
export function unacknowledged(violations: Violation[], acknowledged: readonly string[]) {
  return warnings(violations).filter((violation) => !acknowledged.includes(violation.code));
}

function violation(
  code: RuleCode,
  message: string,
  extra: Omit<Violation, "code" | "severity" | "message"> = {},
): Violation {
  return { code, severity: SEVERITY[code], message, ...extra };
}

// Work that counts against rest time, daily/weekly maximum and consecutive days.
const isWork = (shift: { category: string }) => shift.category === "WORK" || shift.category === "STANDBY";
const isAbsence = (shift: { category: string }) => shift.category === "ABSENCE";

export function isNightShift(shift: Pick<RosterShift, "plannedStart" | "plannedEnd">, snapshot: ScheduleSnapshot) {
  const { nightStart, nightEnd, timezone } = snapshot.ruleSet;
  return windowMinutes(shift.plannedStart, shift.plannedEnd, nightStart, nightEnd, timezone) >= 120;
}

export function shiftNetMinutes(shift: Pick<RosterShift, "plannedStart" | "plannedEnd" | "breakMinutes">) {
  return netMinutes(shift.plannedStart, shift.plannedEnd, shift.breakMinutes);
}

// Angerechnete Arbeitszeit eines Dienstes (z. B. Rufbereitschaft mit Faktor).
export function creditedMinutes(shift: RosterShift, types: Record<string, ShiftTypeInfo>) {
  if (isAbsence(shift)) return 0;
  return Math.round(shiftNetMinutes(shift) * (types[shift.shiftTypeId]?.workTimeFactor ?? 1));
}

const overlaps = (a: RosterShift, b: RosterShift) =>
  Date.parse(a.plannedStart) < Date.parse(b.plannedEnd) && Date.parse(b.plannedStart) < Date.parse(a.plannedEnd);

function hasQualification(employee: EmployeeInfo | undefined, qualificationId: string, date: string) {
  return !!employee?.qualifications.some(
    (grant) =>
      grant.qualificationId === qualificationId &&
      grant.validFrom <= date &&
      (!grant.validUntil || grant.validUntil >= date),
  );
}

function periodFor(snapshot: ScheduleSnapshot, unitId: string, date: string) {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  return snapshot.periods.find((p) => p.unitId === unitId && p.year === year && p.month === month) ?? null;
}

type Labels = ReturnType<typeof labels>;
function labels(snapshot: ScheduleSnapshot) {
  const tz = snapshot.ruleSet.timezone;
  return {
    name: (employeeId: string) => snapshot.employees[employeeId]?.name ?? "Unbekannte Person",
    type: (shift: Pick<RosterShift, "shiftTypeId">) => snapshot.shiftTypes[shift.shiftTypeId]?.name ?? "Dienst",
    time: (instant: string) => localTime(instant, tz),
    span: (shift: Pick<RosterShift, "plannedStart" | "plannedEnd">) =>
      `${localTime(shift.plannedStart, tz)}–${localTime(shift.plannedEnd, tz)}`,
    date: (date: string) => formatDate(date),
    qualification: (id: string) => snapshot.qualificationNames[id] ?? "die erforderliche Qualifikation",
  };
}

// Planned times of a new or moved shift from its type, in the zone of the rule set.
export function timesFor(snapshot: ScheduleSnapshot, shiftTypeId: string, date: string) {
  const type = snapshot.shiftTypes[shiftTypeId];
  if (!type) return null;
  const { start, end } = plannedInterval(date, type.startTime, type.endTime, snapshot.ruleSet.timezone);
  return {
    plannedStart: start.toISOString(),
    plannedEnd: end.toISOString(),
    breakMinutes: type.breakMinutes,
    category: type.category,
  };
}

// Keeps the local start and end time of a shift on another day (custom times stay custom).
function movedTimes(snapshot: ScheduleSnapshot, shift: RosterShift, date: string) {
  const tz = snapshot.ruleSet.timezone;
  const endDayOffset = daysBetween(shift.date, localDate(shift.plannedEnd, tz));
  return {
    plannedStart: zonedToUtc(date, localTime(shift.plannedStart, tz), tz).toISOString(),
    plannedEnd: zonedToUtc(addDays(date, endDayOffset), localTime(shift.plannedEnd, tz), tz).toISOString(),
  };
}

export type AppliedChanges = {
  shifts: RosterShift[];
  // Shifts created or changed by the changes (after the change).
  touched: RosterShift[];
  // Shifts as they were before being changed, moved, swapped or deleted.
  previous: RosterShift[];
  violations: Violation[];
};

// Applies changes to the snapshot's shifts without validating the resulting plan.
export function applyChanges(snapshot: ScheduleSnapshot, changes: ShiftChange[]): AppliedChanges {
  const shifts = new Map(snapshot.shifts.map((shift) => [shift.id, { ...shift }]));
  const touched = new Set<string>();
  const previous: RosterShift[] = [];
  const violations: Violation[] = [];
  const l = labels(snapshot);

  const existing = (shiftId: string, expectedVersion: number | null, allowTimeEntry = false) => {
    const shift = shifts.get(shiftId);
    if (!shift) {
      violations.push(violation("STALE_VERSION", "Dieser Dienst existiert nicht mehr. Bitte neu laden.", { shiftId }));
      return null;
    }
    if (expectedVersion !== null && shift.version !== expectedVersion) {
      violations.push(
        violation("STALE_VERSION", "Dieser Dienst wurde inzwischen geändert. Bitte neu laden.", {
          shiftId,
          employeeId: shift.employeeId,
          date: shift.date,
        }),
      );
      return null;
    }
    if (shift.hasTimeEntry && !allowTimeEntry) {
      violations.push(
        violation("SHIFT_HAS_TIME_ENTRY", "Für diesen Dienst wurde bereits Arbeitszeit erfasst.", {
          shiftId,
          employeeId: shift.employeeId,
          date: shift.date,
        }),
      );
      return null;
    }
    previous.push({ ...shift });
    return shift;
  };

  for (const change of changes) {
    if (change.kind === "create") {
      const input = change.shift;
      const times = timesFor(snapshot, input.shiftTypeId, input.date);
      if (!times) {
        violations.push(violation("STALE_VERSION", "Der Diensttyp ist nicht mehr verfügbar.", { date: input.date }));
        continue;
      }
      const period = periodFor(snapshot, input.unitId, input.date);
      const shift: RosterShift = {
        id: input.id,
        periodId: period?.id ?? "",
        unitId: input.unitId,
        employeeId: input.employeeId,
        shiftTypeId: input.shiftTypeId,
        category: times.category,
        date: input.date,
        plannedStart: input.plannedStart ?? times.plannedStart,
        plannedEnd: input.plannedEnd ?? times.plannedEnd,
        breakMinutes: input.breakMinutes ?? times.breakMinutes,
        source: "MANUAL",
        notes: input.notes ?? null,
        lastSwapId: null,
        version: 0,
        hasTimeEntry: false,
      };
      shifts.set(shift.id, shift);
      touched.add(shift.id);
    } else if (change.kind === "update" || change.kind === "move") {
      const shift = existing(change.shiftId, change.expectedVersion);
      if (!shift) continue;
      const patch = change.kind === "move" ? { employeeId: change.employeeId, date: change.date } : { ...change.patch };
      const typeChanged = patch.shiftTypeId !== undefined && patch.shiftTypeId !== shift.shiftTypeId;
      const dateChanged = patch.date !== undefined && patch.date !== shift.date;
      if (patch.employeeId) shift.employeeId = patch.employeeId;
      if (patch.notes !== undefined) shift.notes = patch.notes;
      if (typeChanged) {
        const times = timesFor(snapshot, patch.shiftTypeId!, patch.date ?? shift.date);
        if (!times) {
          violations.push(violation("STALE_VERSION", "Der Diensttyp ist nicht mehr verfügbar.", { shiftId: shift.id }));
          continue;
        }
        shift.shiftTypeId = patch.shiftTypeId!;
        shift.category = times.category;
        shift.plannedStart = times.plannedStart;
        shift.plannedEnd = times.plannedEnd;
        shift.breakMinutes = times.breakMinutes;
        shift.date = patch.date ?? shift.date;
      } else if (dateChanged) {
        Object.assign(shift, movedTimes(snapshot, shift, patch.date!));
        shift.date = patch.date!;
      }
      if (patch.plannedStart) shift.plannedStart = patch.plannedStart;
      if (patch.plannedEnd) shift.plannedEnd = patch.plannedEnd;
      if (patch.breakMinutes !== undefined) shift.breakMinutes = patch.breakMinutes;
      if (patch.date || patch.plannedStart) {
        const period = periodFor(snapshot, shift.unitId, shift.date);
        shift.periodId = period?.id ?? "";
      }
      shift.version += 1;
      touched.add(shift.id);
    } else if (change.kind === "delete") {
      const shift = existing(change.shiftId, change.expectedVersion);
      if (shift) shifts.delete(shift.id);
    } else if (change.kind === "swap") {
      const source = existing(change.sourceShiftId, change.sourceVersion);
      const target = change.targetShiftId ? existing(change.targetShiftId, change.targetVersion) : null;
      if (!source || (change.targetShiftId && !target)) continue;
      const requester = source.employeeId;
      if (target && target.employeeId !== change.targetEmployeeId) {
        violations.push(
          violation("SWAP_NOT_ALLOWED", `Der Gegendienst gehört nicht mehr ${l.name(change.targetEmployeeId)}.`, {
            shiftId: target.id,
          }),
        );
        continue;
      }
      source.employeeId = change.targetEmployeeId;
      source.version += 1;
      source.source = "SWAP";
      touched.add(source.id);
      if (target) {
        target.employeeId = requester;
        target.version += 1;
        target.source = "SWAP";
        touched.add(target.id);
      }
    }
  }
  const all = [...shifts.values()];
  return { shifts: all, touched: all.filter((shift) => touched.has(shift.id)), previous, violations };
}

type Index = {
  byEmployee: Map<string, RosterShift[]>;
};
function index(shifts: RosterShift[]): Index {
  const byEmployee = new Map<string, RosterShift[]>();
  for (const shift of shifts) {
    const list = byEmployee.get(shift.employeeId) ?? [];
    list.push(shift);
    byEmployee.set(shift.employeeId, list);
  }
  for (const list of byEmployee.values()) list.sort((a, b) => a.plannedStart.localeCompare(b.plannedStart));
  return { byEmployee };
}

function absenceRange(list: RosterShift[], date: string) {
  const days = new Set(list.filter(isAbsence).map((shift) => shift.date));
  let from = date;
  let to = date;
  while (days.has(addDays(from, -1))) from = addDays(from, -1);
  while (days.has(addDays(to, 1))) to = addDays(to, 1);
  return from === to ? `am ${formatDate(from)}` : `vom ${formatDate(from)}–${formatDate(to)}`;
}

// Regeln, die ein einzelner Dienst im Zusammenhang mit den übrigen Diensten der Person verletzt.
function shiftViolations(snapshot: ScheduleSnapshot, shift: RosterShift, idx: Index, l: Labels): Violation[] {
  const result: Violation[] = [];
  const at = { shiftId: shift.id, employeeId: shift.employeeId, date: shift.date };
  const employee = snapshot.employees[shift.employeeId];
  const type = snapshot.shiftTypes[shift.shiftTypeId];
  const name = l.name(shift.employeeId);
  const rules = snapshot.ruleSet;

  if (!snapshot.managedUnitIds.includes(shift.unitId) || !employee?.unitIds.includes(shift.unitId))
    result.push(violation("OUT_OF_SCOPE", `${name} gehört nicht zu Ihrer Wohngruppe.`, at));

  if (!employee || !employee.active)
    result.push(violation("EMPLOYEE_INACTIVE", `${name} ist nicht mehr aktiv und kann nicht eingeplant werden.`, at));
  else if (employee.employmentEnd && shift.date > employee.employmentEnd)
    result.push(
      violation(
        "EMPLOYEE_INACTIVE",
        `${name} ist ab ${formatDate(addDays(employee.employmentEnd, 1), true)} nicht mehr angestellt.`,
        at,
      ),
    );
  else if (employee.employmentStart && shift.date < employee.employmentStart)
    result.push(
      violation(
        "EMPLOYEE_INACTIVE",
        `${name} ist erst ab ${formatDate(employee.employmentStart, true)} angestellt.`,
        at,
      ),
    );

  const period = periodFor(snapshot, shift.unitId, shift.date);
  if (period?.lockedAt)
    result.push(
      violation("PERIOD_LOCKED", `Der Monat ${monthLabel(period.year, period.month)} ist abgeschlossen.`, at),
    );

  const own = (idx.byEmployee.get(shift.employeeId) ?? []).filter((other) => other.id !== shift.id);

  if (isAbsence(shift)) {
    const sameDayAbsence = own.find((other) => isAbsence(other) && other.date === shift.date);
    if (sameDayAbsence)
      result.push(
        violation(
          "OVERLAP",
          `${name} ist am ${l.date(shift.date)} bereits als ${l.type(sameDayAbsence)} eingetragen.`,
          at,
        ),
      );
    const work = own.find((other) => !isAbsence(other) && other.date === shift.date);
    if (work)
      result.push(
        violation(
          "ABSENCE_CONFLICT",
          `${name} ist am ${l.date(shift.date)} bereits von ${l.span(work)} eingeteilt.`,
          at,
        ),
      );
    return result;
  }

  const overlapping = own.find((other) => !isAbsence(other) && overlaps(shift, other));
  if (overlapping)
    result.push(
      violation(
        "OVERLAP",
        `${name} ist am ${l.date(overlapping.date)} bereits von ${l.span(overlapping)} eingeteilt.`,
        at,
      ),
    );

  if (own.some((other) => isAbsence(other) && other.date === shift.date))
    result.push(violation("ABSENCE_CONFLICT", `${name} ist ${absenceRange(own, shift.date)} abwesend.`, at));

  const approved = snapshot.timeOff.find(
    (request) =>
      request.employeeId === shift.employeeId &&
      request.status === "APPROVED" &&
      request.startDate <= shift.date &&
      request.endDate >= shift.date,
  );
  if (approved)
    result.push(violation("APPROVED_TIME_OFF", `Für ${name} ist am ${l.date(shift.date)} Wunschfrei genehmigt.`, at));

  if (isWork(shift)) {
    const start = Date.parse(shift.plannedStart);
    const end = Date.parse(shift.plannedEnd);
    const work = own.filter((other) => isWork(other) && !overlaps(shift, other));
    const before = work.filter((other) => Date.parse(other.plannedEnd) <= start).at(-1);
    const after = work.find((other) => Date.parse(other.plannedStart) >= end);
    for (const [first, second] of [
      [before, shift],
      [shift, after],
    ] as const) {
      if (!first || !second) continue;
      const rest = minutesBetween(first.plannedEnd, second.plannedStart);
      if (rest < rules.minRestMinutes)
        result.push(
          violation(
            "REST_TIME",
            `Zwischen ${l.type(first)} (Ende ${l.time(first.plannedEnd)}) und ${l.type(second)} (Beginn ${l.time(second.plannedStart)}) liegen nur ${formatHours(rest).replace(" h", "")} h statt ${formatHours(rules.minRestMinutes).replace(" h", "")} h.`,
            { ...at, meta: { restMinutes: rest, otherShiftId: first === shift ? second.id : first.id } },
          ),
        );
    }

    const net = shiftNetMinutes(shift);
    if (net > rules.maxDailyWorkMinutes)
      result.push(
        violation(
          "MAX_DAILY_WORK",
          `Dienst überschreitet die maximale Tagesarbeitszeit (${formatHours(net).replace(" h", "")} h > ${formatHours(rules.maxDailyWorkMinutes)}).`,
          at,
        ),
      );
  }

  for (const qualificationId of type?.requiredQualificationIds ?? [])
    if (!hasQualification(employee, qualificationId, shift.date))
      result.push(
        violation(
          "QUALIFICATION_MISSING",
          `${type!.name} erfordert „${l.qualification(qualificationId)}“ – fehlt bei ${name}.`,
          at,
        ),
      );

  const excluded = employee?.excludedCategories ?? [];
  const hit =
    excluded.includes("NIGHT") && isNightShift(shift, snapshot)
      ? "NIGHT"
      : excluded.find((category) => category === shift.category);
  if (hit)
    result.push(violation("EXCLUDED_CATEGORY", `${name} ist nicht für ${EXCLUSION_LABELS[hit]} einplanbar.`, at));

  const open = snapshot.timeOff.find(
    (request) =>
      request.employeeId === shift.employeeId &&
      request.status === "OPEN" &&
      request.startDate <= shift.date &&
      request.endDate >= shift.date,
  );
  if (open)
    result.push(
      violation("OPEN_TIME_OFF_IGNORED", `Offener Wunschfrei-Antrag von ${name} am ${l.date(shift.date)}.`, at),
    );

  for (const preference of snapshot.preferences)
    if (preference.employeeId === shift.employeeId && ignoresPreference(snapshot, preference, shift))
      result.push(
        violation(
          "PREFERENCE_IGNORED",
          `Dienstwunsch von ${name} „${describePreference(snapshot, preference)}“ nicht berücksichtigt.`,
          { ...at, meta: { preferenceId: preference.id } },
        ),
      );

  return result;
}

const preferenceApplies = (preference: ShiftPreference, date: string) =>
  preference.active &&
  (!preference.validFrom || preference.validFrom <= date) &&
  (!preference.validUntil || preference.validUntil >= date) &&
  (!preference.date || preference.date === date);

export function ignoresPreference(snapshot: ScheduleSnapshot, preference: ShiftPreference, shift: RosterShift) {
  if (!preferenceApplies(preference, shift.date) || isAbsence(shift)) return false;
  const sameWeekday = !preference.weekday || preference.weekday === weekday(shift.date);
  switch (preference.kind) {
    case "AVOID_SHIFT_TYPE":
      return preference.shiftTypeId === shift.shiftTypeId && sameWeekday;
    case "AVOID_WEEKDAY":
      return preference.weekday === weekday(shift.date);
    case "AVOID_CATEGORY":
      return preference.category === "NIGHT"
        ? isNightShift(shift, snapshot)
        : preference.category === shift.category && sameWeekday;
    default:
      return false;
  }
}

export function describePreference(snapshot: ScheduleSnapshot, preference: ShiftPreference) {
  const type = preference.shiftTypeId ? (snapshot.shiftTypes[preference.shiftTypeId]?.name ?? "Diensttyp") : "";
  const day = preference.weekday ? ` am ${WEEKDAY_LABELS[preference.weekday - 1]}` : "";
  const on = preference.date ? ` am ${formatDate(preference.date)}` : "";
  switch (preference.kind) {
    case "PREFER_SHIFT_TYPE":
      return `gerne ${type}${day}${on}`;
    case "AVOID_SHIFT_TYPE":
      return `kein ${type}${day}${on}`;
    case "PREFER_WEEKDAY":
      return `gerne${day || " an diesem Tag"}${on}`;
    case "AVOID_WEEKDAY":
      return `nicht${day}${on}`;
    case "AVOID_CATEGORY":
      return `keine ${preference.category ? EXCLUSION_LABELS[preference.category] : "Dienste dieser Art"}${day}${on}`;
  }
}

// Mindestbesetzung für einen Tag und Diensttyp (Datum überschreibt Wochentag).
export function requirementFor(snapshot: ScheduleSnapshot, unitId: string, shiftTypeId: string, date: string) {
  const matching = snapshot.staffing.filter((r) => r.unitId === unitId && r.shiftTypeId === shiftTypeId);
  return (
    matching.find((r) => r.date === date) ??
    matching.find((r) => r.date === null && r.weekday === weekday(date)) ??
    null
  );
}

type StaffingCount = { count: number; qualified: number };
function staffingCount(
  snapshot: ScheduleSnapshot,
  shifts: RosterShift[],
  unitId: string,
  shiftTypeId: string,
  date: string,
  requirement: StaffingRequirement | null,
): StaffingCount {
  const staffed = shifts.filter((s) => s.unitId === unitId && s.shiftTypeId === shiftTypeId && s.date === date);
  return {
    count: staffed.length,
    qualified: requirement?.qualificationId
      ? staffed.filter((s) => hasQualification(snapshot.employees[s.employeeId], requirement.qualificationId!, date))
          .length
      : 0,
  };
}

function staffingViolations(
  snapshot: ScheduleSnapshot,
  key: { unitId: string; shiftTypeId: string; date: string },
  after: StaffingCount,
  before: StaffingCount | null,
): Violation[] {
  const requirement = requirementFor(snapshot, key.unitId, key.shiftTypeId, key.date);
  if (!requirement) return [];
  const type = snapshot.shiftTypes[key.shiftTypeId];
  const day = `${WEEKDAY_LABELS[weekday(key.date) - 1]} ${formatDate(key.date)}`;
  const meta = { unitId: key.unitId, shiftTypeId: key.shiftTypeId };
  const result: Violation[] = [];
  const worse = (value: number, old: number | undefined) => old === undefined || value < old;
  if (after.count < requirement.minCount && worse(after.count, before?.count))
    result.push(
      violation(
        "MIN_STAFFING",
        `${day}, ${type?.name ?? "Dienst"}: ${after.count} von mindestens ${requirement.minCount} ${requirement.minCount === 1 ? "Person" : "Personen"}.`,
        { date: key.date, meta: { ...meta, count: after.count, min: requirement.minCount } },
      ),
    );
  if (
    requirement.minQualified &&
    requirement.qualificationId &&
    after.qualified < requirement.minQualified &&
    worse(after.qualified, before?.qualified)
  ) {
    const qualification = snapshot.qualificationNames[requirement.qualificationId] ?? "Fachperson";
    result.push(
      violation(
        "MIN_QUALIFIED",
        after.qualified === 0
          ? `${type?.name ?? "Dienst"} ${formatDate(key.date)}: keine ${qualification} eingeteilt.`
          : `${type?.name ?? "Dienst"} ${formatDate(key.date)}: ${after.qualified} von mindestens ${requirement.minQualified} ${qualification}.`,
        { date: key.date, meta: { ...meta, qualified: after.qualified, min: requirement.minQualified } },
      ),
    );
  }
  if (
    requirement.maxCount !== null &&
    after.count > requirement.maxCount &&
    (before === null || after.count > before.count)
  )
    result.push(
      violation(
        "MAX_STAFFING",
        `${day}, ${type?.name ?? "Dienst"}: ${after.count} Personen, vorgesehen max. ${requirement.maxCount}.`,
        { date: key.date, meta: { ...meta, count: after.count, max: requirement.maxCount } },
      ),
    );
  return result;
}

function weekMinutes(snapshot: ScheduleSnapshot, list: RosterShift[], date: string) {
  const { year, week } = isoWeek(date);
  return list
    .filter((shift) => {
      const w = isoWeek(shift.date);
      return w.year === year && w.week === week;
    })
    .reduce((sum, shift) => sum + creditedMinutes(shift, snapshot.shiftTypes), 0);
}

function consecutiveRun(list: RosterShift[], date: string) {
  const days = new Set(list.filter(isWork).map((shift) => shift.date));
  if (!days.has(date)) return 0;
  let from = date;
  let to = date;
  while (days.has(addDays(from, -1))) from = addDays(from, -1);
  while (days.has(addDays(to, 1))) to = addDays(to, 1);
  return daysBetween(from, to) + 1;
}

function workloadViolations(
  snapshot: ScheduleSnapshot,
  employeeId: string,
  date: string,
  after: RosterShift[],
  before: RosterShift[] | null,
  l: Labels,
): Violation[] {
  const result: Violation[] = [];
  const rules = snapshot.ruleSet;
  const minutes = weekMinutes(snapshot, after, date);
  const previousMinutes = before ? weekMinutes(snapshot, before, date) : -1;
  if (minutes > rules.maxWeeklyWorkMinutes && minutes > previousMinutes) {
    const { week } = isoWeek(date);
    result.push(
      violation(
        "MAX_WEEKLY_WORK",
        `${l.name(employeeId)}, KW ${week}: ${formatHours(minutes)} geplant, Maximum ${formatHours(rules.maxWeeklyWorkMinutes)}.`,
        { employeeId, date, meta: { week, minutes } },
      ),
    );
  }
  const run = consecutiveRun(after, date);
  const previousRun = before ? consecutiveRun(before, date) : -1;
  if (run > rules.maxConsecutiveWorkDays && run > previousRun)
    result.push(
      violation(
        "MAX_CONSECUTIVE_DAYS",
        `${l.name(employeeId)} hätte ${run} Arbeitstage am Stück (max. ${rules.maxConsecutiveWorkDays}).`,
        { employeeId, date, meta: { days: run } },
      ),
    );
  return result;
}

function dedupe(violations: Violation[]) {
  const seen = new Set<string>();
  return violations.filter((v) => {
    const key = `${v.code}|${v.shiftId ?? ""}|${v.employeeId ?? ""}|${v.date ?? ""}|${v.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const staffingKey = (shift: Pick<RosterShift, "unitId" | "shiftTypeId" | "date">) =>
  `${shift.unitId}|${shift.shiftTypeId}|${shift.date}`;

// Prüft Änderungen gegen den Snapshot. Liefert nur Verstösse, die die Änderungen betreffen;
// Besetzung und Arbeitslast melden sich nur, wenn die Änderung sie verschlechtert.
export function validateChanges(snapshot: ScheduleSnapshot, changes: ShiftChange[]): Violation[] {
  const applied = applyChanges(snapshot, changes);
  const l = labels(snapshot);
  const result = [...applied.violations];
  const afterIndex = index(applied.shifts);
  const beforeIndex = index(snapshot.shifts);

  for (const shift of applied.touched) result.push(...shiftViolations(snapshot, shift, afterIndex, l));

  // Removing or moving a shift out of a locked month or a foreign unit is blocked as well.
  for (const old of applied.previous) {
    if (!snapshot.managedUnitIds.includes(old.unitId))
      result.push(
        violation("OUT_OF_SCOPE", `${l.name(old.employeeId)} gehört nicht zu Ihrer Wohngruppe.`, {
          shiftId: old.id,
          employeeId: old.employeeId,
          date: old.date,
        }),
      );
    const period = periodFor(snapshot, old.unitId, old.date);
    if (period?.lockedAt)
      result.push(
        violation("PERIOD_LOCKED", `Der Monat ${monthLabel(period.year, period.month)} ist abgeschlossen.`, {
          shiftId: old.id,
          date: old.date,
        }),
      );
  }

  const keys = new Map<string, { unitId: string; shiftTypeId: string; date: string }>();
  for (const shift of [...applied.touched, ...applied.previous])
    if (!isAbsence(shift)) keys.set(staffingKey(shift), shift);
  for (const key of keys.values()) {
    const requirement = requirementFor(snapshot, key.unitId, key.shiftTypeId, key.date);
    const after = staffingCount(snapshot, applied.shifts, key.unitId, key.shiftTypeId, key.date, requirement);
    const before = staffingCount(snapshot, snapshot.shifts, key.unitId, key.shiftTypeId, key.date, requirement);
    result.push(...staffingViolations(snapshot, key, after, before));
  }

  const workload = new Map<string, { employeeId: string; date: string }>();
  for (const shift of applied.touched) if (isWork(shift)) workload.set(`${shift.employeeId}|${shift.date}`, shift);
  for (const { employeeId, date } of workload.values())
    result.push(
      ...workloadViolations(
        snapshot,
        employeeId,
        date,
        afterIndex.byEmployee.get(employeeId) ?? [],
        beforeIndex.byEmployee.get(employeeId) ?? [],
        l,
      ),
    );

  return dedupe(result);
}

// Analyse einer ganzen Periode (Dashboard, Veröffentlichung, KI-Optimierung): alle Probleme im Monat.
export function analyzeSchedule(snapshot: ScheduleSnapshot, year: number, month: number): Violation[] {
  const l = labels(snapshot);
  const prefix = `${year}-${String(month).padStart(2, "0")}-`;
  const idx = index(snapshot.shifts);
  const inPeriod = snapshot.shifts.filter((s) => s.unitId === snapshot.unitId && s.date.startsWith(prefix));
  const result: Violation[] = [];

  for (const shift of inPeriod)
    result.push(
      ...shiftViolations(snapshot, shift, idx, l).filter(
        (v) =>
          v.code !== "OUT_OF_SCOPE" || snapshot.employees[shift.employeeId]?.unitIds.includes(shift.unitId) !== true,
      ),
    );

  const days = Array.from({ length: new Date(Date.UTC(year, month, 0)).getUTCDate() }, (_, i) =>
    addDays(`${prefix}01`, i),
  );
  for (const date of days)
    for (const type of Object.values(snapshot.shiftTypes)) {
      if (type.category === "ABSENCE") continue;
      const requirement = requirementFor(snapshot, snapshot.unitId, type.id, date);
      if (!requirement) continue;
      const key = { unitId: snapshot.unitId, shiftTypeId: type.id, date };
      result.push(
        ...staffingViolations(
          snapshot,
          key,
          staffingCount(snapshot, snapshot.shifts, snapshot.unitId, type.id, date, requirement),
          null,
        ),
      );
    }

  const employees = [...new Set(inPeriod.map((shift) => shift.employeeId))];
  for (const employeeId of employees) {
    const list = idx.byEmployee.get(employeeId) ?? [];
    const own = list.filter((shift) => shift.date.startsWith(prefix));
    const weeks = new Map<string, string>();
    for (const shift of own.filter(isWork))
      weeks.set(`${isoWeek(shift.date).year}-${isoWeek(shift.date).week}`, shift.date);
    for (const date of weeks.values())
      result.push(
        ...workloadViolations(snapshot, employeeId, date, list, null, l).filter((v) => v.code === "MAX_WEEKLY_WORK"),
      );
    const runs = new Set<number>();
    for (const shift of own.filter(isWork)) {
      const run = consecutiveRun(list, shift.date);
      if (run > snapshot.ruleSet.maxConsecutiveWorkDays && !runs.has(run)) {
        runs.add(run);
        result.push(
          ...workloadViolations(snapshot, employeeId, shift.date, list, null, l).filter(
            (v) => v.code === "MAX_CONSECUTIVE_DAYS",
          ),
        );
      }
    }
  }

  // Soll-Abweichung aller planbaren Personen des Wohnbereichs.
  for (const employee of Object.values(snapshot.employees)) {
    if (!employee.unitIds.includes(snapshot.unitId) || !employee.active) continue;
    const own = (idx.byEmployee.get(employee.id) ?? []).filter((shift) => shift.date.startsWith(prefix));
    const target = targetMinutesForMonth(snapshot.ruleSet, employee, year, month, snapshot.holidays);
    const planned = plannedMinutesFor(snapshot, employee, own);
    if (Math.abs(planned - target) >= 60)
      result.push(
        violation(
          "TARGET_DEVIATION",
          `${employee.name}: geplant ${formatHours(planned)}, Soll ${formatHours(target)} (${formatHours(planned - target, true)}).`,
          { employeeId: employee.id, meta: { planned, target } },
        ),
      );
  }

  result.push(...distributionViolations(snapshot, inPeriod));
  return dedupe(result);
}

// Geplante, angerechnete Minuten: Dienste mit Faktor plus Abwesenheiten mit Anrechnung (Tagessoll).
export function plannedMinutesFor(snapshot: ScheduleSnapshot, employee: EmployeeInfo, shifts: RosterShift[]) {
  const holidays = new Set(snapshot.holidays);
  const daily = dailyTargetMinutes(snapshot.ruleSet.weeklyNormMinutes, employee);
  return shifts.reduce((sum, shift) => {
    if (!isAbsence(shift)) return sum + creditedMinutes(shift, snapshot.shiftTypes);
    const credits = snapshot.shiftTypes[shift.shiftTypeId]?.creditsTarget;
    return credits && weekday(shift.date) <= 5 && !holidays.has(shift.date) ? sum + daily : sum;
  }, 0);
}

// Ungleiche Verteilung von Nacht- und Wochenenddiensten (bezogen auf das Pensum).
function distributionViolations(snapshot: ScheduleSnapshot, shifts: RosterShift[]): Violation[] {
  const result: Violation[] = [];
  const people = Object.values(snapshot.employees).filter(
    (employee) => employee.active && employee.unitIds.includes(snapshot.unitId),
  );
  if (people.length < 2) return result;
  for (const [label, test] of [
    ["Nachtdienste", (shift: RosterShift) => isNightShift(shift, snapshot)],
    ["Wochenenddienste", (shift: RosterShift) => isWeekend(shift.date)],
  ] as const) {
    const eligible = people.filter(
      (employee) => !(label === "Nachtdienste" && employee.excludedCategories.includes("NIGHT")),
    );
    if (eligible.length < 2) continue;
    const normalized = eligible.map((employee) => ({
      employee,
      count: shifts.filter((shift) => shift.employeeId === employee.id && isWork(shift) && test(shift)).length,
      value:
        shifts.filter((shift) => shift.employeeId === employee.id && isWork(shift) && test(shift)).length /
        (employee.pensumPercent / 100),
    }));
    const max = normalized.reduce((a, b) => (b.value > a.value ? b : a));
    const min = normalized.reduce((a, b) => (b.value < a.value ? b : a));
    if (max.value - min.value >= 3)
      result.push(
        violation(
          "UNEVEN_DISTRIBUTION",
          `${label} ungleich verteilt: ${max.employee.name} ${max.count}, ${min.employee.name} ${min.count} (bezogen auf das Pensum).`,
          { meta: { kind: label, max: max.employee.id, min: min.employee.id } },
        ),
      );
  }
  return result;
}
