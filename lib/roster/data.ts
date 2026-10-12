import "server-only";
import { iso, type Row } from "@/lib/api-context";
import type { RosterContext } from "./context";
import { countryProfile } from "@/lib/country";
import { DEFAULT_SHIFT_TYPES } from "./defaults";
import { notFound } from "./errors";
import { managedUnitIds } from "./permissions";
import { addDays, monthEnd, monthStart } from "./time";
import type {
  EmployeeInfo,
  ExclusionCategory,
  PeriodInfo,
  QualificationGrant,
  RosterShift,
  RuleSet,
  ScheduleSnapshot,
  ShiftPreference,
  ShiftTypeInfo,
  StaffingRequirement,
  TimeOffRequest,
} from "./types";

// Laden von Regelwerk, Stammdaten und Snapshots für die Regel-Engine. Alle Abfragen sind auf die
// Organisation der handelnden Person beschränkt.

const text = (value: unknown) => (value === null || value === undefined ? null : String(value));
const list = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

export function mapRuleSet(row: Row): RuleSet {
  return {
    id: String(row.id),
    careUnitId: text(row.care_unit_id),
    timezone: String(row.timezone),
    weeklyNormMinutes: Number(row.weekly_norm_minutes),
    minRestMinutes: Number(row.min_rest_minutes),
    maxDailyWorkMinutes: Number(row.max_daily_work_minutes),
    maxWeeklyWorkMinutes: Number(row.max_weekly_work_minutes),
    maxConsecutiveWorkDays: Number(row.max_consecutive_work_days),
    breakRules: list<{ minWorkMinutes: number; minBreakMinutes: number }>(row.break_rules).map((rule) => ({
      minWorkMinutes: Number(rule.minWorkMinutes),
      minBreakMinutes: Number(rule.minBreakMinutes),
    })),
    nightStart: String(row.night_start),
    nightEnd: String(row.night_end),
    deviationThresholdMinutes: Number(row.deviation_threshold_minutes),
    missingClockOutAfterMinutes: Number(row.missing_clock_out_after_minutes),
    clockInEarliestMinutes: Number(row.clock_in_earliest_minutes),
    autoSwapApproval: Boolean(row.auto_swap_approval),
    allowShiftTakeover: Boolean(row.allow_shift_takeover),
    aiRunsPerHour: Number(row.ai_runs_per_hour),
    valuesConfirmed: Boolean(row.values_confirmed_at),
  };
}

// New organisations get the same basic data as the migration gave existing ones.
export async function ensureRosterDefaults(ctx: RosterContext) {
  const org = ctx.actor.organizationId;
  const [organization] = (await ctx.sql`SELECT country FROM carecore_organizations WHERE id = ${org}`) as Row[];
  await ctx.sql.transaction([
    ctx.sql`INSERT INTO carecore_rule_sets (organization_id, timezone)
      SELECT id, timezone FROM carecore_organizations WHERE id = ${org} ON CONFLICT DO NOTHING`,
    ...countryProfile(organization?.country).qualifications.map(
      (q) => ctx.sql`INSERT INTO carecore_qualifications (organization_id, code, name, grants_medication)
        VALUES (${org}, ${q.code}, ${q.name}, ${q.grantsMedication}) ON CONFLICT (organization_id, code) DO NOTHING`,
    ),
    ...DEFAULT_SHIFT_TYPES.map(
      (
        t,
      ) => ctx.sql`INSERT INTO carecore_shift_types (organization_id, name, code, category, absence_kind, start_time, end_time,
          break_minutes, color, work_time_factor, credits_target, sort_order)
        VALUES (${org}, ${t.name}, ${t.code}, ${t.category}, ${t.absenceKind}, ${t.startTime}, ${t.endTime}, ${t.breakMinutes},
          ${t.color}, ${t.workTimeFactor}, ${t.creditsTarget}, ${t.sortOrder})
        ON CONFLICT (organization_id, code) DO NOTHING`,
    ),
  ]);
}

// Regelwerk eines Wohnbereichs: eigene Überschreibung oder das der Organisation.
export async function loadRuleSet(ctx: RosterContext, unitId: string | null): Promise<RuleSet> {
  const read = () =>
    ctx.sql`
      SELECT * FROM carecore_rule_sets
      WHERE organization_id = ${ctx.actor.organizationId} AND (care_unit_id IS NULL OR care_unit_id = ${unitId}::uuid)
      ORDER BY care_unit_id IS NULL LIMIT 1` as Promise<Row[]>;
  let rows = await read();
  if (!rows[0]) {
    await ensureRosterDefaults(ctx);
    rows = await read();
  }
  return mapRuleSet(rows[0]);
}

export function mapShiftType(row: Row): ShiftTypeInfo {
  return {
    id: String(row.id),
    careUnitId: text(row.care_unit_id),
    name: String(row.name),
    code: String(row.code),
    category: row.category as ShiftTypeInfo["category"],
    absenceKind: (row.absence_kind as ShiftTypeInfo["absenceKind"]) ?? null,
    startTime: String(row.start_time),
    endTime: String(row.end_time),
    breakMinutes: Number(row.break_minutes),
    color: String(row.color),
    workTimeFactor: Number(row.work_time_factor),
    creditsTarget: Boolean(row.credits_target),
    requiredQualificationIds: list<string>(row.required_qualification_ids).map(String),
    active: Boolean(row.active),
    sortOrder: Number(row.sort_order),
  };
}

export async function loadShiftTypes(ctx: RosterContext): Promise<Record<string, ShiftTypeInfo>> {
  const rows = (await ctx.sql`
    SELECT id, care_unit_id, name, code, category, absence_kind, start_time, end_time, break_minutes, color,
      work_time_factor, credits_target, to_jsonb(required_qualification_ids) AS required_qualification_ids, active, sort_order
    FROM carecore_shift_types WHERE organization_id = ${ctx.actor.organizationId}
    ORDER BY sort_order, name`) as Row[];
  return Object.fromEntries(rows.map((row) => [String(row.id), mapShiftType(row)]));
}

export const SHIFT_COLUMNS = `s.id, s.period_id, s.care_unit_id, s.employee_id, s.shift_type_id, s.category,
  to_char(s.date, 'YYYY-MM-DD') AS date, s.planned_start, s.planned_end, s.break_minutes, s.source, s.notes,
  s.last_swap_id, s.version, EXISTS (SELECT 1 FROM carecore_time_entries te WHERE te.shift_id = s.id) AS has_time_entry`;

export function mapShift(row: Row): RosterShift {
  return {
    id: String(row.id),
    periodId: String(row.period_id),
    unitId: String(row.care_unit_id),
    employeeId: String(row.employee_id),
    shiftTypeId: String(row.shift_type_id),
    category: row.category as RosterShift["category"],
    date: String(row.date),
    plannedStart: iso(row.planned_start) ?? "",
    plannedEnd: iso(row.planned_end) ?? "",
    breakMinutes: Number(row.break_minutes),
    source: row.source as RosterShift["source"],
    notes: text(row.notes),
    lastSwapId: text(row.last_swap_id),
    version: Number(row.version),
    hasTimeEntry: Boolean(row.has_time_entry),
  };
}

export async function loadShift(ctx: RosterContext, shiftId: string) {
  const rows = (await ctx.sql.query(
    `SELECT ${SHIFT_COLUMNS} FROM carecore_roster_shifts s WHERE s.id = $1 AND s.organization_id = $2`,
    [shiftId, ctx.actor.organizationId],
  )) as Row[];
  if (!rows[0]) throw notFound("Dienst");
  return mapShift(rows[0]);
}

export async function loadEmployees(ctx: RosterContext, ids: string[]): Promise<Record<string, EmployeeInfo>> {
  if (!ids.length) return {};
  const rows = (await ctx.sql`
    SELECT u.id, u.display_name, u.active AND COALESCE(ep.active, TRUE) AS active,
      COALESCE(ep.pensum_percent, 100) AS pensum_percent, ep.weekly_target_minutes_override,
      to_char(ep.employment_start, 'YYYY-MM-DD') AS employment_start, to_char(ep.employment_end, 'YYYY-MM-DD') AS employment_end,
      to_jsonb(COALESCE(ep.excluded_categories, '{}'::text[])) AS excluded_categories,
      COALESCE((SELECT jsonb_agg(m.care_unit_id ORDER BY m.care_unit_id = p.primary_care_unit_id DESC NULLS LAST, m.created_at)
        FROM carecore_unit_memberships m WHERE m.user_id = u.id AND m.plannable), '[]'::jsonb) AS unit_ids,
      COALESCE((SELECT jsonb_agg(jsonb_build_object('qualificationId', q.qualification_id,
        'validFrom', to_char(q.valid_from, 'YYYY-MM-DD'), 'validUntil', to_char(q.valid_until, 'YYYY-MM-DD')))
        FROM carecore_employee_qualifications q WHERE q.user_id = u.id), '[]'::jsonb) AS qualifications
    FROM carecore_users u
    JOIN carecore_user_profiles p ON p.user_id = u.id AND p.organization_id = ${ctx.actor.organizationId}
    LEFT JOIN carecore_employee_profiles ep ON ep.user_id = u.id
    WHERE u.id = ANY(${ids}::uuid[])`) as Row[];
  return Object.fromEntries(
    rows.map((row) => [
      String(row.id),
      {
        id: String(row.id),
        name: String(row.display_name),
        pensumPercent: Number(row.pensum_percent),
        weeklyTargetMinutesOverride:
          row.weekly_target_minutes_override === null ? null : Number(row.weekly_target_minutes_override),
        employmentStart: text(row.employment_start),
        employmentEnd: text(row.employment_end),
        active: Boolean(row.active),
        excludedCategories: list<ExclusionCategory>(row.excluded_categories),
        unitIds: list<string>(row.unit_ids).map(String),
        qualifications: list<QualificationGrant>(row.qualifications),
      } satisfies EmployeeInfo,
    ]),
  );
}

// Planbare Mitglieder eines Wohnbereichs (Zeilen im Raster).
export async function unitMemberIds(ctx: RosterContext, unitId: string) {
  const rows = (await ctx.sql`
    SELECT m.user_id FROM carecore_unit_memberships m
    JOIN carecore_users u ON u.id = m.user_id
    JOIN carecore_user_profiles p ON p.user_id = u.id AND p.organization_id = ${ctx.actor.organizationId}
    WHERE m.care_unit_id = ${unitId} AND m.plannable AND u.archived_at IS NULL`) as Row[];
  return rows.map((row) => String(row.user_id));
}

export function mapPeriod(row: Row): PeriodInfo {
  return {
    id: String(row.id),
    unitId: String(row.care_unit_id),
    year: Number(row.year),
    month: Number(row.month),
    status: row.status as PeriodInfo["status"],
    lockedAt: iso(row.locked_at),
    version: Number(row.version),
  };
}

export async function findPeriod(ctx: RosterContext, unitId: string, year: number, month: number) {
  const rows = (await ctx.sql`
    SELECT * FROM carecore_schedule_periods
    WHERE care_unit_id = ${unitId} AND year = ${year} AND month = ${month} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  return rows[0] ? mapPeriod(rows[0]) : null;
}

// Neue Monate entstehen beim ersten Öffnen durch die Leitung als Entwurf.
export async function ensurePeriod(ctx: RosterContext, unitId: string, year: number, month: number) {
  const existing = await findPeriod(ctx, unitId, year, month);
  if (existing) return existing;
  await ctx.sql`
    INSERT INTO carecore_schedule_periods (organization_id, care_unit_id, year, month)
    VALUES (${ctx.actor.organizationId}, ${unitId}, ${year}, ${month})
    ON CONFLICT (care_unit_id, year, month) DO NOTHING`;
  return (await findPeriod(ctx, unitId, year, month))!;
}

export type SnapshotOptions = { unitId: string; from: string; to: string; employeeIds?: string[] };

// Snapshot für die Regel-Engine: Dienste der Personen (alle Wohnbereiche) inklusive einer Woche
// Rand vor und nach dem Zeitraum, damit Ruhezeit und Folgetage über Monatsgrenzen stimmen.
export async function loadSnapshot(ctx: RosterContext, options: SnapshotOptions): Promise<ScheduleSnapshot> {
  const from = addDays(options.from, -7);
  const to = addDays(options.to, 7);
  const org = ctx.actor.organizationId;
  const members = await unitMemberIds(ctx, options.unitId);
  const seed = [...new Set([...members, ...(options.employeeIds ?? [])])];
  const shiftRows = (await ctx.sql.query(
    `SELECT ${SHIFT_COLUMNS} FROM carecore_roster_shifts s
     WHERE s.organization_id = $1 AND s.date BETWEEN $2::date AND $3::date
       AND (s.employee_id = ANY($4::uuid[]) OR s.care_unit_id = $5)`,
    [org, from, to, seed, options.unitId],
  )) as Row[];
  const shifts = shiftRows.map(mapShift);
  const employeeIds = [...new Set([...seed, ...shifts.map((shift) => shift.employeeId)])];
  const unitIds = [...new Set([options.unitId, ...shifts.map((shift) => shift.unitId)])];

  const [
    ruleSet,
    employees,
    shiftTypes,
    periodRows,
    staffingRows,
    timeOffRows,
    preferenceRows,
    holidayRows,
    qualificationRows,
  ] = await Promise.all([
    loadRuleSet(ctx, options.unitId),
    loadEmployees(ctx, employeeIds),
    loadShiftTypes(ctx),
    ctx.sql`
        SELECT * FROM carecore_schedule_periods
        WHERE organization_id = ${org} AND care_unit_id = ANY(${unitIds}::uuid[])
          AND make_date(year, month, 1) BETWEEN date_trunc('month', ${from}::date) AND ${to}::date` as Promise<Row[]>,
    ctx.sql`
        SELECT id, care_unit_id, shift_type_id, weekday, to_char(date, 'YYYY-MM-DD') AS date, min_count, max_count,
          min_qualified, qualification_id
        FROM carecore_staffing_requirements WHERE care_unit_id = ${options.unitId}` as Promise<Row[]>,
    ctx.sql`
        SELECT id, employee_id, care_unit_id, to_char(start_date, 'YYYY-MM-DD') AS start_date,
          to_char(end_date, 'YYYY-MM-DD') AS end_date, priority, status
        FROM carecore_time_off_requests
        WHERE organization_id = ${org} AND employee_id = ANY(${employeeIds}::uuid[]) AND status IN ('OPEN', 'APPROVED')
          AND end_date >= ${from}::date AND start_date <= ${to}::date` as Promise<Row[]>,
    ctx.sql`
        SELECT id, employee_id, kind, shift_type_id, weekday, category, to_char(date, 'YYYY-MM-DD') AS date,
          to_char(valid_from, 'YYYY-MM-DD') AS valid_from, to_char(valid_until, 'YYYY-MM-DD') AS valid_until, comment, active
        FROM carecore_shift_preferences
        WHERE organization_id = ${org} AND employee_id = ANY(${employeeIds}::uuid[]) AND active` as Promise<Row[]>,
    ctx.sql`
        SELECT to_char(date, 'YYYY-MM-DD') AS date FROM carecore_public_holidays
        WHERE organization_id = ${org} AND date BETWEEN ${from}::date AND ${to}::date` as Promise<Row[]>,
    ctx.sql`SELECT id, name FROM carecore_qualifications WHERE organization_id = ${org}` as Promise<Row[]>,
  ]);

  return {
    unitId: options.unitId,
    ruleSet,
    now: new Date().toISOString(),
    periods: periodRows.map(mapPeriod),
    shifts,
    employees,
    shiftTypes,
    staffing: staffingRows.map((row): StaffingRequirement => ({
      id: String(row.id),
      unitId: String(row.care_unit_id),
      shiftTypeId: String(row.shift_type_id),
      weekday: row.weekday === null ? null : Number(row.weekday),
      date: text(row.date),
      minCount: Number(row.min_count),
      maxCount: row.max_count === null ? null : Number(row.max_count),
      minQualified: row.min_qualified === null ? null : Number(row.min_qualified),
      qualificationId: text(row.qualification_id),
    })),
    timeOff: timeOffRows.map((row): TimeOffRequest => ({
      id: String(row.id),
      employeeId: String(row.employee_id),
      unitId: String(row.care_unit_id),
      startDate: String(row.start_date),
      endDate: String(row.end_date),
      priority: row.priority as TimeOffRequest["priority"],
      status: row.status as TimeOffRequest["status"],
    })),
    preferences: preferenceRows.map((row): ShiftPreference => ({
      id: String(row.id),
      employeeId: String(row.employee_id),
      kind: row.kind as ShiftPreference["kind"],
      shiftTypeId: text(row.shift_type_id),
      weekday: row.weekday === null ? null : Number(row.weekday),
      category: (row.category as ShiftPreference["category"]) ?? null,
      date: text(row.date),
      validFrom: text(row.valid_from),
      validUntil: text(row.valid_until),
      comment: text(row.comment),
      active: Boolean(row.active),
    })),
    holidays: holidayRows.map((row) => String(row.date)),
    qualificationNames: Object.fromEntries(qualificationRows.map((row) => [String(row.id), String(row.name)])),
    managedUnitIds: managedUnitIds(ctx.access),
  };
}

export const monthRange = (year: number, month: number) => ({
  from: monthStart(year, month),
  to: monthEnd(year, month),
});

export async function orgToday(ctx: RosterContext, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
