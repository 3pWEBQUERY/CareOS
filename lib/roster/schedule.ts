import "server-only";
import type { Row } from "@/lib/api-context";
import { iso } from "@/lib/api-context";
import { mistralConfigured } from "@/lib/mistral";
import type { RosterContext } from "./context";
import { unitsFor } from "./context";
import { ensurePeriod, findPeriod, loadSnapshot, monthRange, unitMemberIds } from "./data";
import { RosterError, notFound } from "./errors";
import { isLeadOf, isMemberOf, managedUnitIds, visibleUnitIds } from "./permissions";
import { analyzeSchedule, describePreference, requirementFor, shiftNetMinutes } from "./rules";
import { deviation, isWeekend, localDate, monthDays, weekday } from "./time";
import type { RosterShift, ScheduleSnapshot, Violation } from "./types";
import type { GridEmployee, GridShift, SchedulePayload, StaffingCell, UnitOption } from "./view-types";
import { summarizeMonth, type TimeEntryInfo } from "./worktime";

// Wohnbereich aus der Anfrage oder der erste, den die Person sehen darf.
export function resolveUnit(ctx: RosterContext, requested: string | null, prefer: "lead" | "member" = "lead") {
  const visible = visibleUnitIds(ctx.access);
  if (requested) {
    if (!visible.includes(requested)) throw notFound("Wohnbereich");
    return requested;
  }
  const ordered =
    prefer === "lead"
      ? [...managedUnitIds(ctx.access), ...ctx.access.memberUnitIds]
      : [...ctx.access.memberUnitIds, ...managedUnitIds(ctx.access)];
  if (!ordered[0])
    throw new RosterError("NO_UNIT", "Du bist keinem Wohnbereich zugeordnet. Bitte die Leitung kontaktieren.", 404);
  return ordered[0];
}

export async function unitOptions(ctx: RosterContext): Promise<UnitOption[]> {
  const units = await unitsFor(ctx, visibleUnitIds(ctx.access));
  return units.map((unit) => ({ ...unit, lead: isLeadOf(ctx.access, unit.id) }));
}

export async function loadEntries(
  ctx: RosterContext,
  employeeIds: string[],
  from: string,
  to: string,
): Promise<TimeEntryInfo[]> {
  if (!employeeIds.length) return [];
  const rows = (await ctx.sql`
    SELECT id, employee_id, shift_id, to_char(date, 'YYYY-MM-DD') AS date, clock_in, clock_out, break_minutes, actual_minutes, status, version
    FROM carecore_time_entries
    WHERE organization_id = ${ctx.actor.organizationId} AND employee_id = ANY(${employeeIds}::uuid[])
      AND date BETWEEN ${from}::date AND ${to}::date`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    employeeId: String(row.employee_id),
    shiftId: row.shift_id ? String(row.shift_id) : null,
    date: String(row.date),
    clockIn: iso(row.clock_in) ?? "",
    clockOut: iso(row.clock_out),
    breakMinutes: Number(row.break_minutes),
    actualMinutes: row.actual_minutes === null ? null : Number(row.actual_minutes),
    status: row.status as TimeEntryInfo["status"],
    version: Number(row.version),
  }));
}

// Kurzer Vergleichswert, ob sich der Plan geändert hat (Polling, Spec 8.13).
export async function changeToken(ctx: RosterContext, unitId: string, year: number, month: number) {
  const { from, to } = monthRange(year, month);
  const rows = (await ctx.sql`
    SELECT
      (SELECT COALESCE(MAX(updated_at)::text, '') || ':' || COUNT(*) FROM carecore_roster_shifts
        WHERE care_unit_id = ${unitId} AND date BETWEEN ${from}::date AND ${to}::date) AS shifts,
      (SELECT COALESCE(MAX(version), 0) || ':' || COALESCE(MAX(status), '') || ':' || COALESCE(MAX(locked_at)::text, '')
        FROM carecore_schedule_periods WHERE care_unit_id = ${unitId} AND year = ${year} AND month = ${month}) AS period,
      (SELECT COALESCE(MAX(updated_at)::text, '') || ':' || COUNT(*) FROM carecore_time_off_requests WHERE care_unit_id = ${unitId}) AS time_off,
      (SELECT COALESCE(MAX(updated_at)::text, '') || ':' || COUNT(*) FROM carecore_shift_swaps WHERE care_unit_id = ${unitId}) AS swaps,
      (SELECT COALESCE(MAX(updated_at)::text, '') || ':' || COUNT(*) FROM carecore_time_entries
        WHERE care_unit_id = ${unitId} AND date BETWEEN ${from}::date AND ${to}::date) AS entries`) as Row[];
  const row = rows[0] ?? {};
  return [row.shifts, row.period, row.time_off, row.swaps, row.entries].join("|");
}

function gridShift(
  snapshot: ScheduleSnapshot,
  shift: RosterShift,
  options: {
    masked: boolean;
    entry: TimeEntryInfo | undefined;
    swap: { with: string; at: string | null } | null;
    violations: Violation[];
  },
): GridShift {
  const type = snapshot.shiftTypes[shift.shiftTypeId];
  if (options.masked)
    return {
      id: shift.id,
      employeeId: shift.employeeId,
      unitId: shift.unitId,
      shiftTypeId: null,
      code: "A",
      name: "Abwesend",
      color: "#6b7280",
      category: "ABSENCE",
      absenceKind: null,
      date: shift.date,
      plannedStart: shift.plannedStart,
      plannedEnd: shift.plannedEnd,
      breakMinutes: 0,
      netMinutes: 0,
      source: shift.source,
      notes: null,
      version: shift.version,
      swapped: null,
      entry: null,
      violations: [],
      masked: true,
    };
  const entry = options.entry;
  const dev = entry?.clockOut
    ? deviation(
        { start: shift.plannedStart, end: shift.plannedEnd, breakMinutes: shift.breakMinutes },
        { clockIn: entry.clockIn, clockOut: entry.clockOut, breakMinutes: entry.breakMinutes },
      )
    : null;
  return {
    id: shift.id,
    employeeId: shift.employeeId,
    unitId: shift.unitId,
    shiftTypeId: shift.shiftTypeId,
    code: type?.code ?? "?",
    name: type?.name ?? "Dienst",
    color: type?.color ?? "#475569",
    category: shift.category,
    absenceKind: type?.absenceKind ?? null,
    date: shift.date,
    plannedStart: shift.plannedStart,
    plannedEnd: shift.plannedEnd,
    breakMinutes: shift.breakMinutes,
    netMinutes: shift.category === "ABSENCE" ? 0 : shiftNetMinutes(shift),
    source: shift.source,
    notes: shift.notes,
    version: shift.version,
    swapped: options.swap,
    entry: entry
      ? {
          id: entry.id,
          clockIn: entry.clockIn,
          clockOut: entry.clockOut,
          breakMinutes: entry.breakMinutes,
          actualMinutes: entry.actualMinutes,
          status: entry.status,
          differenceMinutes: dev?.differenceMinutes ?? null,
          startDeviationMinutes: Math.round((Date.parse(entry.clockIn) - Date.parse(shift.plannedStart)) / 60_000),
          endDeviationMinutes: dev?.endDeviationMinutes ?? null,
        }
      : null,
    violations: options.violations,
    masked: false,
  };
}

export async function getSchedule(
  ctx: RosterContext,
  params: { unitId: string | null; year: number; month: number; team?: boolean },
): Promise<SchedulePayload> {
  // team: Teamplan (Spec 8.5) – auch die Leitung sieht dort nur den veröffentlichten Plan ohne Planungsdaten.
  const unitId = resolveUnit(ctx, params.unitId, params.team ? "member" : "lead");
  const leadOfUnit = isLeadOf(ctx.access, unitId);
  const lead = leadOfUnit && !params.team;
  if (!leadOfUnit && !isMemberOf(ctx.access, unitId)) throw notFound("Wohnbereich");
  const { year, month } = params;
  const { from, to } = monthRange(year, month);
  const period = lead ? await ensurePeriod(ctx, unitId, year, month) : await findPeriod(ctx, unitId, year, month);
  const visiblePlan = lead || period?.status === "PUBLISHED";

  const [snapshot, units, members, token] = await Promise.all([
    loadSnapshot(ctx, { unitId, from, to }),
    unitOptions(ctx),
    unitMemberIds(ctx, unitId),
    changeToken(ctx, unitId, year, month),
  ]);
  const tz = snapshot.ruleSet.timezone;
  const today = localDate(new Date(), tz);
  const days = monthDays(year, month);
  const holidayNames = await holidayNamesFor(ctx, from, to);

  const inMonth = (shift: RosterShift) => shift.date >= from && shift.date <= to;
  const unitShifts = visiblePlan ? snapshot.shifts.filter((s) => s.unitId === unitId && inMonth(s)) : [];
  const rowIds = [...new Set([...members, ...unitShifts.map((s) => s.employeeId)])].filter(
    (id) => snapshot.employees[id],
  );
  const entries = lead
    ? await loadEntries(ctx, rowIds, from, to)
    : (await loadEntries(ctx, [ctx.actor.id], from, to)).filter((entry) => entry.employeeId === ctx.actor.id);
  const entryByShift = new Map(entries.filter((e) => e.shiftId).map((e) => [e.shiftId!, e]));

  const violations = lead ? analyzeSchedule(snapshot, year, month) : [];
  const swaps = await swapInfo(
    ctx,
    unitShifts.filter((s) => s.lastSwapId).map((s) => s.lastSwapId!),
  );

  const shifts = unitShifts.map((shift) =>
    gridShift(snapshot, shift, {
      masked: !lead && shift.category === "ABSENCE" && shift.employeeId !== ctx.actor.id,
      entry: lead || shift.employeeId === ctx.actor.id ? entryByShift.get(shift.id) : undefined,
      swap: shift.lastSwapId ? (swaps.get(shift.lastSwapId) ?? null) : null,
      violations: violations.filter((v) => v.shiftId === shift.id),
    }),
  );

  const employees: GridEmployee[] = rowIds
    .map((id) => snapshot.employees[id])
    .sort((a, b) => a.name.localeCompare(b.name, "de-CH"))
    .map((employee) => {
      const showNumbers = lead || employee.id === ctx.actor.id;
      const summary = showNumbers
        ? summarizeMonth({
            rules: snapshot.ruleSet,
            employee,
            year,
            month,
            holidays: snapshot.holidays,
            shifts: snapshot.shifts.filter(inMonth),
            entries,
            types: snapshot.shiftTypes,
            now: new Date().toISOString(),
            today,
          })
        : null;
      return {
        id: employee.id,
        name: employee.name,
        pensumPercent: employee.pensumPercent,
        qualifications: employee.qualifications
          .filter((q) => !q.validUntil || q.validUntil >= from)
          .map((q) => snapshot.qualificationNames[q.qualificationId] ?? "")
          .filter(Boolean),
        excluded: lead ? employee.excludedCategories : [],
        otherUnits: employee.unitIds
          .filter((id) => id !== unitId)
          .map((id) => units.find((u) => u.id === id)?.name ?? "anderer Wohnbereich"),
        targetMinutes: summary?.targetMinutes ?? null,
        plannedMinutes: summary?.plannedMinutes ?? null,
        actualMinutes: summary?.actualMinutes ?? null,
        preferences: lead
          ? snapshot.preferences.filter((p) => p.employeeId === employee.id).map((p) => describePreference(snapshot, p))
          : [],
        timeOff:
          lead || employee.id === ctx.actor.id
            ? snapshot.timeOff
                .filter((t) => t.employeeId === employee.id && t.endDate >= from && t.startDate <= to)
                .map((t) => ({
                  id: t.id,
                  startDate: t.startDate,
                  endDate: t.endDate,
                  status: t.status,
                  priority: t.priority,
                }))
            : [],
        isSelf: employee.id === ctx.actor.id,
      };
    });

  const staffing: StaffingCell[] = [];
  if (visiblePlan)
    for (const day of days)
      for (const type of Object.values(snapshot.shiftTypes)) {
        if (type.category === "ABSENCE") continue;
        const requirement = requirementFor(snapshot, unitId, type.id, day);
        const staffed = unitShifts.filter((s) => s.shiftTypeId === type.id && s.date === day);
        if (!requirement && !staffed.length) continue;
        staffing.push({
          date: day,
          shiftTypeId: type.id,
          count: staffed.length,
          min: requirement?.minCount ?? null,
          max: requirement?.maxCount ?? null,
          minQualified: requirement?.minQualified ?? null,
          qualified: requirement?.qualificationId
            ? staffed.filter((s) =>
                snapshot.employees[s.employeeId]?.qualifications.some(
                  (q) =>
                    q.qualificationId === requirement.qualificationId &&
                    q.validFrom <= day &&
                    (!q.validUntil || q.validUntil >= day),
                ),
              ).length
            : null,
        });
      }

  const usedTypes = new Set(unitShifts.map((s) => s.shiftTypeId));
  const shiftTypes = Object.values(snapshot.shiftTypes)
    .filter((type) => (type.active && (!type.careUnitId || type.careUnitId === unitId)) || usedTypes.has(type.id))
    .filter((type) => lead || type.category !== "ABSENCE" || usedTypes.has(type.id))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  const tiles = lead
    ? await scheduleTiles(ctx, unitId, snapshot, unitShifts, entries, violations, rowIds.length, today)
    : null;

  return {
    unit: { id: unitId, name: units.find((u) => u.id === unitId)?.name ?? "Wohnbereich" },
    units,
    year,
    month,
    today,
    timezone: tz,
    lead,
    period: period
      ? { id: period.id, status: period.status, publishedAt: null, lockedAt: period.lockedAt, version: period.version }
      : null,
    canEdit: lead && !period?.lockedAt,
    days: days.map((day) => ({
      date: day,
      weekday: weekday(day),
      weekend: isWeekend(day),
      holiday: holidayNames.get(day) ?? null,
      today: day === today,
    })),
    employees,
    shiftTypes,
    shifts,
    staffing,
    violations,
    tiles,
    ruleSet: {
      valuesConfirmed: snapshot.ruleSet.valuesConfirmed,
      autoSwapApproval: snapshot.ruleSet.autoSwapApproval,
      allowShiftTakeover: snapshot.ruleSet.allowShiftTakeover,
      deviationThresholdMinutes: snapshot.ruleSet.deviationThresholdMinutes,
    },
    aiAvailable: lead && mistralConfigured(),
    candidates: lead && !period?.lockedAt ? await planningCandidates(ctx, unitId, rowIds) : [],
    changeToken: token,
  };
}

// Personen der Organisation, die beim Einplanen dem Wohnbereich zugeordnet werden können.
async function planningCandidates(ctx: RosterContext, unitId: string, exclude: string[]) {
  const rows = (await ctx.sql`
    SELECT u.id, u.display_name, p.job_title, cu.name AS unit
    FROM carecore_users u
    JOIN carecore_user_profiles p ON p.user_id = u.id AND p.organization_id = ${ctx.actor.organizationId}
    LEFT JOIN carecore_employee_profiles ep ON ep.user_id = u.id
    LEFT JOIN carecore_care_units cu ON cu.id = p.primary_care_unit_id
    WHERE u.active AND u.archived_at IS NULL AND COALESCE(ep.active, TRUE)
      AND NOT (u.id = ANY(${exclude}::uuid[]))
      AND NOT EXISTS (SELECT 1 FROM carecore_unit_memberships m WHERE m.user_id = u.id AND m.care_unit_id = ${unitId} AND m.plannable)
    ORDER BY u.display_name
    LIMIT 300`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.display_name),
    detail: [row.job_title, row.unit].filter(Boolean).join(" · ") || null,
  }));
}

async function holidayNamesFor(ctx: RosterContext, from: string, to: string) {
  const rows = (await ctx.sql`
    SELECT to_char(date, 'YYYY-MM-DD') AS date, name FROM carecore_public_holidays
    WHERE organization_id = ${ctx.actor.organizationId} AND date BETWEEN ${from}::date AND ${to}::date`) as Row[];
  return new Map(rows.map((row) => [String(row.date), String(row.name)]));
}

async function swapInfo(ctx: RosterContext, swapIds: string[]) {
  if (!swapIds.length) return new Map<string, { with: string; at: string | null }>();
  const rows = (await ctx.sql`
    SELECT sw.id, sw.executed_at, r.display_name AS requester, t.display_name AS target
    FROM carecore_shift_swaps sw
    JOIN carecore_users r ON r.id = sw.requester_id
    JOIN carecore_users t ON t.id = sw.target_employee_id
    WHERE sw.id = ANY(${swapIds}::uuid[]) AND sw.organization_id = ${ctx.actor.organizationId}`) as Row[];
  return new Map(
    rows.map((row) => [String(row.id), { with: `${row.requester} ↔ ${row.target}`, at: iso(row.executed_at) }]),
  );
}

async function scheduleTiles(
  ctx: RosterContext,
  unitId: string,
  snapshot: ScheduleSnapshot,
  shifts: RosterShift[],
  entries: TimeEntryInfo[],
  violations: Violation[],
  employees: number,
  today: string,
) {
  const rows = (await ctx.sql`
    SELECT
      (SELECT COUNT(*) FROM carecore_time_off_requests WHERE care_unit_id = ${unitId} AND status = 'OPEN')::int AS time_off,
      (SELECT COUNT(*) FROM carecore_shift_swaps WHERE care_unit_id = ${unitId} AND status IN ('PENDING_TARGET', 'PENDING_APPROVAL'))::int AS swaps`) as Row[];
  const threshold = snapshot.ruleSet.deviationThresholdMinutes;
  const deviations = entries.filter((entry) => {
    if (!entry.shiftId || !entry.clockOut) return entry.status === "INCOMPLETE";
    const shift = shifts.find((s) => s.id === entry.shiftId);
    if (!shift) return false;
    const d = deviation(
      { start: shift.plannedStart, end: shift.plannedEnd, breakMinutes: shift.breakMinutes },
      { clockIn: entry.clockIn, clockOut: entry.clockOut, breakMinutes: entry.breakMinutes },
    );
    return Math.abs(d.differenceMinutes) >= threshold;
  }).length;
  return {
    employees,
    shiftsToday: shifts.filter((s) => s.date === today && s.category !== "ABSENCE").length,
    openTimeOff: Number(rows[0]?.time_off ?? 0),
    openSwaps: Number(rows[0]?.swaps ?? 0),
    deviations,
    understaffedDays: new Set(
      violations.filter((v) => v.code === "MIN_STAFFING" || v.code === "MIN_QUALIFIED").map((v) => v.date),
    ).size,
    targetDeviations: violations.filter((v) => v.code === "TARGET_DEVIATION").length,
  };
}
