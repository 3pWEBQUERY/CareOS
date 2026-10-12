import "server-only";
import type { Row } from "@/lib/api-context";
import { auditQuery } from "./audit";
import type { RosterContext } from "./context";
import { requirePermission } from "./context";
import { loadEmployees, loadRuleSet, loadShiftTypes, mapRuleSet, unitMemberIds } from "./data";
import { forbidden, invalid, notFound } from "./errors";
import { managedUnitIds } from "./permissions";
import {
  ABSENCE_KINDS,
  CATEGORIES,
  EXCLUSIONS,
  bool,
  color,
  date,
  int,
  num,
  oneOf,
  optionalDate,
  optionalInt,
  optionalUuid,
  stringList,
  text,
  time,
  uuid,
  uuidList,
  type Body,
} from "./schemas";
import { unitOptions } from "./schedule";
import { publicHolidays } from "@/lib/holidays";
import type { CountryCode } from "@/lib/country";
import { organizationLocation } from "@/lib/organization-country";
import type { RuleSet, ShiftTypeInfo } from "./types";
import { WAGE_SOURCES, type WageSource, type WageType } from "./payroll-shared";

// Einstellungen des Dienstplans (Spec 8.2): Diensttypen, Mindestbesetzung, Regelwerk, Feiertage,
// Personal. Organisationsweites pflegt die Administration, Wohnbereichsbezogenes die Leitung.

export type SettingsPayload = {
  unitId: string | null;
  units: Awaited<ReturnType<typeof unitOptions>>;
  isAdmin: boolean;
  ruleSet: RuleSet;
  hasUnitOverride: boolean;
  shiftTypes: Array<ShiftTypeInfo & { used: boolean }>;
  staffing: Array<{
    id: string;
    shiftTypeId: string;
    weekday: number | null;
    date: string | null;
    minCount: number;
    maxCount: number | null;
    minQualified: number | null;
    qualificationId: string | null;
  }>;
  // Land und Kanton bzw. Bundesland der Einrichtung (welche Feiertage „übernehmen“ anbietet).
  country: CountryCode;
  region: string | null;
  holidays: Array<{ id: string; date: string; name: string }>;
  qualifications: Array<{ id: string; code: string; name: string; grantsMedication: boolean }>;
  // Lohnarten für den Lohn-Export (organisationsweit).
  wageTypes: WageType[];
  employees: Array<{
    id: string;
    name: string;
    // Personalnummer der Lohnbuchhaltung.
    employeeNumber: string;
    pensumPercent: number;
    weeklyTargetMinutesOverride: number | null;
    employmentStart: string | null;
    employmentEnd: string | null;
    active: boolean;
    excludedCategories: string[];
    unitIds: string[];
    leadUnitIds: string[];
    qualifications: Array<{ qualificationId: string; validFrom: string; validUntil: string | null }>;
  }>;
};

export async function getSettings(ctx: RosterContext, requestedUnit: string | null): Promise<SettingsPayload> {
  const managed = managedUnitIds(ctx.access);
  if (!managed.length && !ctx.access.isAdmin) throw forbidden("Die Einstellungen pflegt die Leitung.");
  const unitId = requestedUnit ?? managed[0] ?? null;
  if (unitId) requirePermission(ctx, "diensttypen:manage", unitId);
  const org = ctx.actor.organizationId;
  const [units, ruleSet, override, types, used, staffingRows, holidayRows, qualificationRows, wageRows] =
    await Promise.all([
      unitOptions(ctx),
      loadRuleSet(ctx, unitId),
      unitId
        ? (ctx.sql`SELECT 1 FROM carecore_rule_sets WHERE care_unit_id = ${unitId}` as Promise<Row[]>)
        : Promise.resolve([] as Row[]),
      loadShiftTypes(ctx),
      ctx.sql`SELECT DISTINCT shift_type_id FROM carecore_roster_shifts WHERE organization_id = ${org}` as Promise<
        Row[]
      >,
      unitId
        ? (ctx.sql`SELECT id, shift_type_id, weekday, to_char(date, 'YYYY-MM-DD') AS date, min_count, max_count, min_qualified, qualification_id
          FROM carecore_staffing_requirements WHERE care_unit_id = ${unitId} ORDER BY date NULLS FIRST, weekday` as Promise<
            Row[]
          >)
        : Promise.resolve([] as Row[]),
      ctx.sql`SELECT id, to_char(date, 'YYYY-MM-DD') AS date, name FROM carecore_public_holidays
      WHERE organization_id = ${org} AND date >= date_trunc('year', NOW()) - INTERVAL '1 year' ORDER BY date` as Promise<
        Row[]
      >,
      ctx.sql`SELECT id, code, name, grants_medication FROM carecore_qualifications WHERE organization_id = ${org} ORDER BY code` as Promise<
        Row[]
      >,
      loadWageTypes(ctx),
    ]);
  const usedIds = new Set(used.map((row) => String(row.shift_type_id)));
  const memberIds = unitId ? await unitMemberIds(ctx, unitId) : [];
  const leadRows = memberIds.length
    ? ((await ctx.sql`SELECT user_id, care_unit_id FROM carecore_unit_memberships WHERE is_lead AND user_id = ANY(${memberIds}::uuid[])`) as Row[])
    : [];
  const employees = await loadEmployees(ctx, memberIds);
  const numbers = await employeeNumbers(ctx, memberIds);
  const { country, region } = await organizationLocation(ctx);
  return {
    unitId,
    country,
    region,
    units: units.filter((unit) => unit.lead),
    isAdmin: ctx.access.isAdmin,
    ruleSet,
    hasUnitOverride: Boolean(override[0]),
    shiftTypes: Object.values(types)
      .filter((type) => !type.careUnitId || managed.includes(type.careUnitId))
      .map((type) => ({ ...type, used: usedIds.has(type.id) })),
    staffing: staffingRows.map((row) => ({
      id: String(row.id),
      shiftTypeId: String(row.shift_type_id),
      weekday: row.weekday === null ? null : Number(row.weekday),
      date: row.date ? String(row.date) : null,
      minCount: Number(row.min_count),
      maxCount: row.max_count === null ? null : Number(row.max_count),
      minQualified: row.min_qualified === null ? null : Number(row.min_qualified),
      qualificationId: row.qualification_id ? String(row.qualification_id) : null,
    })),
    holidays: holidayRows.map((row) => ({ id: String(row.id), date: String(row.date), name: String(row.name) })),
    qualifications: qualificationRows.map((row) => ({
      id: String(row.id),
      code: String(row.code),
      name: String(row.name),
      grantsMedication: Boolean(row.grants_medication),
    })),
    wageTypes: wageRows,
    employees: Object.values(employees)
      .sort((a, b) => a.name.localeCompare(b.name, "de-CH"))
      .map((employee) => ({
        id: employee.id,
        name: employee.name,
        employeeNumber: numbers.get(employee.id) ?? "",
        pensumPercent: employee.pensumPercent,
        weeklyTargetMinutesOverride: employee.weeklyTargetMinutesOverride,
        employmentStart: employee.employmentStart,
        employmentEnd: employee.employmentEnd,
        active: employee.active,
        excludedCategories: employee.excludedCategories,
        unitIds: employee.unitIds,
        leadUnitIds: leadRows
          .filter((row) => String(row.user_id) === employee.id)
          .map((row) => String(row.care_unit_id)),
        qualifications: employee.qualifications,
      })),
  };
}

const audit = (
  ctx: RosterContext,
  action: string,
  entityType: string,
  entityId: string | null,
  unitId: string | null,
  before: unknown,
  after: unknown,
) => auditQuery(ctx, { action, entityType, entityId, unitId, before, after });

// --- Diensttypen -------------------------------------------------------------------------------

async function loadType(ctx: RosterContext, id: string) {
  const types = await loadShiftTypes(ctx);
  const type = types[id];
  if (!type) throw notFound("Diensttyp");
  return type;
}

export async function saveShiftType(ctx: RosterContext, id: string | null, body: Body) {
  const existing = id ? await loadType(ctx, uuid(id, "Diensttyp")) : null;
  const unitId = existing ? existing.careUnitId : optionalUuid(body.unitId, "Wohnbereich");
  requirePermission(ctx, "diensttypen:manage", unitId);
  const category = oneOf(body.category ?? existing?.category, CATEGORIES, "Kategorie");
  const absenceKind =
    category === "ABSENCE"
      ? oneOf(body.absenceKind ?? existing?.absenceKind, ABSENCE_KINDS, "Art der Abwesenheit")
      : null;
  const code = text(body.code ?? existing?.code, "Kürzel", 8, true)!.toUpperCase();
  if (!/^[A-Z0-9ÄÖÜ]{1,8}$/.test(code)) throw invalid("Das Kürzel darf nur Buchstaben und Ziffern enthalten (max. 8).");
  const startTime = time(body.startTime ?? existing?.startTime, "Beginn");
  const endTime = time(body.endTime ?? existing?.endTime, "Ende");
  if (startTime === endTime) throw invalid("Beginn und Ende dürfen nicht gleich sein.");
  const value = {
    name: text(body.name ?? existing?.name, "Name", 80, true)!,
    code,
    category,
    absenceKind,
    startTime,
    endTime,
    breakMinutes: int(body.breakMinutes ?? existing?.breakMinutes ?? 0, "Pause", 0, 240),
    color: color(body.color ?? existing?.color ?? "#2563eb"),
    workTimeFactor: num(body.workTimeFactor ?? existing?.workTimeFactor ?? 1, "Anrechnungsfaktor", 0, 1),
    creditsTarget: category === "ABSENCE" ? bool(body.creditsTarget ?? existing?.creditsTarget) : false,
    requiredQualificationIds: uuidList(
      body.requiredQualificationIds ?? existing?.requiredQualificationIds,
      "Qualifikation",
    ),
    active: body.active === undefined ? (existing?.active ?? true) : bool(body.active),
    sortOrder: int(body.sortOrder ?? existing?.sortOrder ?? 100, "Reihenfolge", 0, 1000),
  };
  const org = ctx.actor.organizationId;
  if (existing) {
    await ctx.sql.transaction([
      ctx.sql`UPDATE carecore_shift_types SET name = ${value.name}, code = ${value.code}, category = ${value.category},
        absence_kind = ${value.absenceKind}, start_time = ${value.startTime}, end_time = ${value.endTime},
        break_minutes = ${value.breakMinutes}, color = ${value.color}, work_time_factor = ${value.workTimeFactor},
        credits_target = ${value.creditsTarget}, required_qualification_ids = ${value.requiredQualificationIds}::uuid[],
        active = ${value.active}, sort_order = ${value.sortOrder}, updated_at = NOW()
        WHERE id = ${existing.id} AND organization_id = ${org}`,
      audit(ctx, "updated", "shift_type", existing.id, unitId, existing, value),
    ]);
    return { id: existing.id };
  }
  const rows = (await ctx.sql`
    INSERT INTO carecore_shift_types (organization_id, care_unit_id, name, code, category, absence_kind, start_time, end_time,
      break_minutes, color, work_time_factor, credits_target, required_qualification_ids, active, sort_order)
    VALUES (${org}, ${unitId}, ${value.name}, ${value.code}, ${value.category}, ${value.absenceKind}, ${value.startTime},
      ${value.endTime}, ${value.breakMinutes}, ${value.color}, ${value.workTimeFactor}, ${value.creditsTarget},
      ${value.requiredQualificationIds}::uuid[], ${value.active}, ${value.sortOrder})
    RETURNING id`) as Row[];
  await audit(ctx, "created", "shift_type", String(rows[0].id), unitId, null, value);
  return { id: String(rows[0].id) };
}

// Diensttypen mit Diensten werden deaktiviert statt gelöscht (FK RESTRICT).
export async function deleteShiftType(ctx: RosterContext, id: string) {
  const type = await loadType(ctx, uuid(id, "Diensttyp"));
  requirePermission(ctx, "diensttypen:manage", type.careUnitId);
  await ctx.sql.transaction([
    ctx.sql`DELETE FROM carecore_shift_types WHERE id = ${type.id} AND organization_id = ${ctx.actor.organizationId}`,
    audit(ctx, "deleted", "shift_type", type.id, type.careUnitId, type, null),
  ]);
  return { id: type.id };
}

// --- Mindestbesetzung --------------------------------------------------------------------------

export async function saveStaffing(ctx: RosterContext, body: Body) {
  const unitId = uuid(body.unitId, "Wohnbereich");
  requirePermission(ctx, "diensttypen:manage", unitId);
  const shiftTypeId = uuid(body.shiftTypeId, "Diensttyp");
  await loadType(ctx, shiftTypeId);
  const specificDate = optionalDate(body.date, "Datum");
  const weekdays = specificDate
    ? [null]
    : (Array.isArray(body.weekdays) ? body.weekdays : [body.weekday]).map((w) => int(w, "Wochentag", 1, 7));
  const minCount = int(body.minCount, "Mindestens", 0, 50);
  const maxCount = optionalInt(body.maxCount, "Höchstens", 0, 50);
  if (maxCount !== null && maxCount < minCount) throw invalid("„Höchstens“ darf nicht kleiner als „Mindestens“ sein.");
  const qualificationId = optionalUuid(body.qualificationId, "Qualifikation");
  const minQualified = qualificationId ? int(body.minQualified ?? 1, "Mindestens qualifiziert", 1, 50) : null;
  const statements = weekdays.map((weekday) =>
    specificDate
      ? ctx.sql`
          INSERT INTO carecore_staffing_requirements (care_unit_id, shift_type_id, date, min_count, max_count, min_qualified, qualification_id)
          VALUES (${unitId}, ${shiftTypeId}, ${specificDate}, ${minCount}, ${maxCount}, ${minQualified}, ${qualificationId})
          ON CONFLICT (care_unit_id, shift_type_id, date) WHERE date IS NOT NULL
          DO UPDATE SET min_count = EXCLUDED.min_count, max_count = EXCLUDED.max_count, min_qualified = EXCLUDED.min_qualified,
            qualification_id = EXCLUDED.qualification_id, updated_at = NOW()`
      : ctx.sql`
          INSERT INTO carecore_staffing_requirements (care_unit_id, shift_type_id, weekday, min_count, max_count, min_qualified, qualification_id)
          VALUES (${unitId}, ${shiftTypeId}, ${weekday}, ${minCount}, ${maxCount}, ${minQualified}, ${qualificationId})
          ON CONFLICT (care_unit_id, shift_type_id, weekday) WHERE weekday IS NOT NULL
          DO UPDATE SET min_count = EXCLUDED.min_count, max_count = EXCLUDED.max_count, min_qualified = EXCLUDED.min_qualified,
            qualification_id = EXCLUDED.qualification_id, updated_at = NOW()`,
  );
  await ctx.sql.transaction([
    ...statements,
    audit(ctx, "saved", "staffing", null, unitId, null, {
      shiftTypeId,
      weekdays,
      date: specificDate,
      minCount,
      maxCount,
      minQualified,
      qualificationId,
    }),
  ]);
  return { saved: statements.length };
}

export async function deleteStaffing(ctx: RosterContext, id: string) {
  const rows = (await ctx.sql`
    SELECT r.* FROM carecore_staffing_requirements r JOIN carecore_care_units cu ON cu.id = r.care_unit_id
    JOIN carecore_sites si ON si.id = cu.site_id WHERE r.id = ${uuid(id, "Vorgabe")} AND si.organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw notFound("Vorgabe");
  const unitId = String(rows[0].care_unit_id);
  requirePermission(ctx, "diensttypen:manage", unitId);
  await ctx.sql.transaction([
    ctx.sql`DELETE FROM carecore_staffing_requirements WHERE id = ${rows[0].id}`,
    audit(ctx, "deleted", "staffing", String(rows[0].id), unitId, rows[0], null),
  ]);
  return { id: String(rows[0].id) };
}

// --- Regelwerk ---------------------------------------------------------------------------------

export async function saveRuleSet(ctx: RosterContext, body: Body) {
  const unitId = optionalUuid(body.unitId, "Wohnbereich");
  requirePermission(ctx, "regelwerk:manage", unitId);
  const org = ctx.actor.organizationId;
  const before = await loadRuleSet(ctx, unitId);
  if (body.action === "removeOverride") {
    if (!unitId) throw invalid("Das Regelwerk der Organisation kann nicht entfernt werden.");
    await ctx.sql.transaction([
      ctx.sql`DELETE FROM carecore_rule_sets WHERE care_unit_id = ${unitId} AND organization_id = ${org}`,
      audit(ctx, "override_removed", "rule_set", before.id, unitId, before, null),
    ]);
    return mapRuleSet({ ...(await loadRuleSetRow(ctx, null)) });
  }
  const breakRules = Array.isArray(body.breakRules)
    ? body.breakRules.map((rule, index) => {
        const value = rule as Record<string, unknown>;
        return {
          minWorkMinutes: int(value.minWorkMinutes, `Pausenstufe ${index + 1}: Arbeitszeit`, 0, 1440),
          minBreakMinutes: int(value.minBreakMinutes, `Pausenstufe ${index + 1}: Pause`, 0, 240),
        };
      })
    : before.breakRules;
  const value = {
    timezone: text(body.timezone ?? before.timezone, "Zeitzone", 64, true)!,
    weeklyNormMinutes: int(body.weeklyNormMinutes ?? before.weeklyNormMinutes, "Wochenarbeitszeit", 60, 6000),
    minRestMinutes: int(body.minRestMinutes ?? before.minRestMinutes, "Ruhezeit", 0, 1440),
    maxDailyWorkMinutes: int(body.maxDailyWorkMinutes ?? before.maxDailyWorkMinutes, "Tagesmaximum", 60, 1440),
    maxWeeklyWorkMinutes: int(body.maxWeeklyWorkMinutes ?? before.maxWeeklyWorkMinutes, "Wochenmaximum", 60, 10080),
    maxConsecutiveWorkDays: int(
      body.maxConsecutiveWorkDays ?? before.maxConsecutiveWorkDays,
      "Arbeitstage am Stück",
      1,
      31,
    ),
    breakRules,
    nightStart: time(body.nightStart ?? before.nightStart, "Nacht ab"),
    nightEnd: time(body.nightEnd ?? before.nightEnd, "Nacht bis"),
    deviationThresholdMinutes: int(
      body.deviationThresholdMinutes ?? before.deviationThresholdMinutes,
      "Abweichungsschwelle",
      1,
      1440,
    ),
    missingClockOutAfterMinutes: int(
      body.missingClockOutAfterMinutes ?? before.missingClockOutAfterMinutes,
      "Frist Ausstempeln",
      1,
      1440,
    ),
    clockInEarliestMinutes: int(
      body.clockInEarliestMinutes ?? before.clockInEarliestMinutes,
      "Einstempeln frühestens",
      0,
      720,
    ),
    autoSwapApproval: body.autoSwapApproval === undefined ? before.autoSwapApproval : bool(body.autoSwapApproval),
    allowShiftTakeover:
      body.allowShiftTakeover === undefined ? before.allowShiftTakeover : bool(body.allowShiftTakeover),
    aiRunsPerHour: int(body.aiRunsPerHour ?? before.aiRunsPerHour, "KI-Läufe pro Stunde", 0, 100),
  };
  try {
    new Intl.DateTimeFormat("de-CH", { timeZone: value.timezone });
  } catch {
    throw invalid("Die Zeitzone ist unbekannt.");
  }
  const confirm = bool(body.confirmValues);
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_rule_sets (organization_id, care_unit_id, timezone, weekly_norm_minutes, min_rest_minutes, max_daily_work_minutes,
        max_weekly_work_minutes, max_consecutive_work_days, break_rules, night_start, night_end, deviation_threshold_minutes,
        missing_clock_out_after_minutes, clock_in_earliest_minutes, auto_swap_approval, allow_shift_takeover, ai_runs_per_hour,
        values_confirmed_at, values_confirmed_by, updated_by)
      VALUES (${org}, ${unitId}, ${value.timezone}, ${value.weeklyNormMinutes}, ${value.minRestMinutes}, ${value.maxDailyWorkMinutes},
        ${value.maxWeeklyWorkMinutes}, ${value.maxConsecutiveWorkDays}, ${JSON.stringify(value.breakRules)}::jsonb, ${value.nightStart},
        ${value.nightEnd}, ${value.deviationThresholdMinutes}, ${value.missingClockOutAfterMinutes}, ${value.clockInEarliestMinutes},
        ${value.autoSwapApproval}, ${value.allowShiftTakeover}, ${value.aiRunsPerHour},
        ${confirm || before.valuesConfirmed ? new Date().toISOString() : null}, ${confirm || before.valuesConfirmed ? ctx.actor.id : null}, ${ctx.actor.id})
      ON CONFLICT (organization_id, COALESCE(care_unit_id, '00000000-0000-0000-0000-000000000000'::uuid))
      DO UPDATE SET timezone = EXCLUDED.timezone, weekly_norm_minutes = EXCLUDED.weekly_norm_minutes,
        min_rest_minutes = EXCLUDED.min_rest_minutes, max_daily_work_minutes = EXCLUDED.max_daily_work_minutes,
        max_weekly_work_minutes = EXCLUDED.max_weekly_work_minutes, max_consecutive_work_days = EXCLUDED.max_consecutive_work_days,
        break_rules = EXCLUDED.break_rules, night_start = EXCLUDED.night_start, night_end = EXCLUDED.night_end,
        deviation_threshold_minutes = EXCLUDED.deviation_threshold_minutes,
        missing_clock_out_after_minutes = EXCLUDED.missing_clock_out_after_minutes,
        clock_in_earliest_minutes = EXCLUDED.clock_in_earliest_minutes, auto_swap_approval = EXCLUDED.auto_swap_approval,
        allow_shift_takeover = EXCLUDED.allow_shift_takeover, ai_runs_per_hour = EXCLUDED.ai_runs_per_hour,
        values_confirmed_at = CASE WHEN ${confirm} THEN NOW() ELSE carecore_rule_sets.values_confirmed_at END,
        values_confirmed_by = CASE WHEN ${confirm} THEN ${ctx.actor.id}::uuid ELSE carecore_rule_sets.values_confirmed_by END,
        updated_at = NOW(), updated_by = ${ctx.actor.id}`,
    audit(ctx, confirm ? "confirmed" : "updated", "rule_set", before.id, unitId, before, {
      ...value,
      confirmed: confirm,
    }),
  ]);
  return loadRuleSet(ctx, unitId);
}

async function loadRuleSetRow(ctx: RosterContext, unitId: string | null) {
  const rows = (await ctx.sql`
    SELECT * FROM carecore_rule_sets WHERE organization_id = ${ctx.actor.organizationId}
      AND care_unit_id IS NOT DISTINCT FROM ${unitId}::uuid`) as Row[];
  return rows[0];
}

// --- Feiertage ---------------------------------------------------------------------------------

// Gesetzliche Feiertage des Kantons bzw. Bundeslandes der Einrichtung (ohne Auswahl die landesweiten).
async function importableHolidays(ctx: RosterContext, year: number) {
  const { country, region } = await organizationLocation(ctx);
  return publicHolidays(country, region, year);
}

export async function saveHolidays(ctx: RosterContext, body: Body) {
  if (!managedUnitIds(ctx.access).length) throw forbidden("Feiertage pflegt die Leitung.");
  const org = ctx.actor.organizationId;
  const entries =
    body.action === "importHolidays"
      ? await importableHolidays(ctx, int(body.year, "Jahr", 2000, 2100))
      : [{ date: date(body.date, "Datum"), name: text(body.name, "Name", 120, true)! }];
  await ctx.sql.transaction([
    ...entries.map(
      (
        holiday,
      ) => ctx.sql`INSERT INTO carecore_public_holidays (organization_id, date, name) VALUES (${org}, ${holiday.date}, ${holiday.name})
        ON CONFLICT (organization_id, date) DO UPDATE SET name = EXCLUDED.name`,
    ),
    audit(ctx, body.action === "importHolidays" ? "imported" : "created", "holiday", null, null, null, entries),
  ]);
  return { saved: entries.length };
}

export async function deleteHoliday(ctx: RosterContext, id: string) {
  if (!managedUnitIds(ctx.access).length) throw forbidden("Feiertage pflegt die Leitung.");
  const rows = (await ctx.sql`
    DELETE FROM carecore_public_holidays WHERE id = ${uuid(id, "Feiertag")} AND organization_id = ${ctx.actor.organizationId}
    RETURNING id, to_char(date, 'YYYY-MM-DD') AS date, name`) as Row[];
  if (!rows[0]) throw notFound("Feiertag");
  await audit(ctx, "deleted", "holiday", String(rows[0].id), null, rows[0], null);
  return { id: String(rows[0].id) };
}

// --- Personal (Pensum, Wohnbereiche, Qualifikationen, Ausschlüsse) ------------------------------

export async function saveEmployeeProfile(ctx: RosterContext, userIdInput: string, body: Body) {
  const userId = uuid(userIdInput, "Person");
  const managed = managedUnitIds(ctx.access);
  const [before] = Object.values(await loadEmployees(ctx, [userId]));
  if (!before) throw notFound("Person");
  // Only people of a unit the actor leads (or admins) can be edited.
  if (!ctx.access.isAdmin && !before.unitIds.some((id) => managed.includes(id))) throw notFound("Person");
  const unitIds = body.unitIds === undefined ? before.unitIds : uuidList(body.unitIds, "Wohnbereich");
  const leadUnitIds = body.leadUnitIds === undefined ? null : uuidList(body.leadUnitIds, "Wohnbereich");
  for (const id of [
    ...unitIds.filter((id) => !before.unitIds.includes(id)),
    ...before.unitIds.filter((id) => !unitIds.includes(id)),
    ...(leadUnitIds ?? []),
  ])
    if (!managed.includes(id)) throw forbidden("Zuordnungen zu fremden Wohnbereichen kann nur deren Leitung ändern.");
  const pensum = num(body.pensumPercent ?? before.pensumPercent, "Pensum", 1, 100);
  const override =
    body.weeklyTargetMinutesOverride === undefined
      ? before.weeklyTargetMinutesOverride
      : optionalInt(body.weeklyTargetMinutesOverride, "Wochensoll", 0, 6000);
  const employmentStart =
    body.employmentStart === undefined ? before.employmentStart : optionalDate(body.employmentStart, "Eintritt");
  const employmentEnd =
    body.employmentEnd === undefined ? before.employmentEnd : optionalDate(body.employmentEnd, "Austritt");
  if (employmentStart && employmentEnd && employmentEnd < employmentStart)
    throw invalid("Der Austritt liegt vor dem Eintritt.");
  const excluded =
    body.excludedCategories === undefined
      ? before.excludedCategories
      : stringList(body.excludedCategories, EXCLUSIONS, "Ausschluss");
  const active = body.active === undefined ? before.active : bool(body.active);
  const employeeNumber =
    body.employeeNumber === undefined ? undefined : (text(body.employeeNumber, "Personalnummer", 80, false) ?? "");
  const qualifications = Array.isArray(body.qualifications)
    ? body.qualifications.map((item) => {
        const value = item as Record<string, unknown>;
        const validFrom = date(value.validFrom ?? "2000-01-01", "Gültig ab");
        const validUntil = optionalDate(value.validUntil, "Gültig bis");
        if (validUntil && validUntil < validFrom) throw invalid("Eine Qualifikation endet vor ihrem Beginn.");
        return { qualificationId: uuid(value.qualificationId, "Qualifikation"), validFrom, validUntil };
      })
    : null;

  const statements = [
    ctx.sql`INSERT INTO carecore_employee_profiles (user_id, pensum_percent, weekly_target_minutes_override, employment_start, employment_end,
        active, excluded_categories)
      VALUES (${userId}, ${pensum}, ${override}, ${employmentStart}, ${employmentEnd}, ${active}, ${excluded}::text[])
      ON CONFLICT (user_id) DO UPDATE SET pensum_percent = EXCLUDED.pensum_percent,
        weekly_target_minutes_override = EXCLUDED.weekly_target_minutes_override, employment_start = EXCLUDED.employment_start,
        employment_end = EXCLUDED.employment_end, active = EXCLUDED.active, excluded_categories = EXCLUDED.excluded_categories,
        updated_at = NOW()`,
  ];
  if (employeeNumber !== undefined)
    statements.push(ctx.sql`UPDATE carecore_user_profiles SET employee_number = ${employeeNumber || null}, updated_at = NOW()
      WHERE user_id = ${userId} AND organization_id = ${ctx.actor.organizationId}`);
  for (const id of managed) {
    const plannable = unitIds.includes(id);
    const lead = leadUnitIds ? leadUnitIds.includes(id) : null;
    statements.push(ctx.sql`
      INSERT INTO carecore_unit_memberships (user_id, care_unit_id, plannable, is_lead)
      SELECT ${userId}, ${id}, ${plannable}, COALESCE(${lead}::boolean, FALSE)
      WHERE ${plannable} OR COALESCE(${lead}::boolean, FALSE)
      ON CONFLICT (user_id, care_unit_id) DO UPDATE SET plannable = EXCLUDED.plannable,
        is_lead = COALESCE(${lead}::boolean, carecore_unit_memberships.is_lead)`);
    statements.push(ctx.sql`DELETE FROM carecore_unit_memberships WHERE user_id = ${userId} AND care_unit_id = ${id}
      AND NOT plannable AND NOT is_lead`);
  }
  if (qualifications) {
    statements.push(ctx.sql`DELETE FROM carecore_employee_qualifications WHERE user_id = ${userId}`);
    for (const q of qualifications)
      statements.push(ctx.sql`INSERT INTO carecore_employee_qualifications (user_id, qualification_id, valid_from, valid_until)
        SELECT ${userId}, ${q.qualificationId}, ${q.validFrom}, ${q.validUntil}
        WHERE EXISTS (SELECT 1 FROM carecore_qualifications WHERE id = ${q.qualificationId} AND organization_id = ${ctx.actor.organizationId})
        ON CONFLICT DO NOTHING`);
  }
  statements.push(
    audit(ctx, "updated", "employee_profile", userId, null, before, {
      pensum,
      override,
      employmentStart,
      employmentEnd,
      active,
      excluded,
      unitIds,
      leadUnitIds,
      qualifications,
      ...(employeeNumber === undefined ? {} : { employeeNumber }),
    }),
  );
  await ctx.sql.transaction(statements);
  return { id: userId };
}

export async function saveQualification(ctx: RosterContext, body: Body) {
  if (!ctx.access.isAdmin && !managedUnitIds(ctx.access).length) throw forbidden();
  const code = text(body.code, "Kürzel", 24, true)!.toUpperCase();
  const name = text(body.name, "Bezeichnung", 120, true)!;
  // Berechtigt die Qualifikation in Rollen wie „Pflege“ zur Medikation (Standard: HF und FaGe)?
  if (body.grantsMedication !== undefined && typeof body.grantsMedication !== "boolean")
    throw invalid("Medikationsberechtigung ist ungültig.");
  const grantsMedication = body.grantsMedication === true;
  const [before] = (await ctx.sql`
    SELECT id, grants_medication FROM carecore_qualifications WHERE organization_id = ${ctx.actor.organizationId} AND code = ${code}`) as Row[];
  const rows = (await ctx.sql`
    INSERT INTO carecore_qualifications (organization_id, code, name, grants_medication)
    VALUES (${ctx.actor.organizationId}, ${code}, ${name}, ${grantsMedication})
    ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name, grants_medication = EXCLUDED.grants_medication
    RETURNING id`) as Row[];
  await audit(
    ctx,
    "saved",
    "qualification",
    String(rows[0].id),
    null,
    before ? { grantsMedication: Boolean(before.grants_medication) } : null,
    { code, name, grantsMedication },
  );
  return { id: String(rows[0].id) };
}

// --- Lohnarten (Lohn-Export) ---------------------------------------------------------------------

export async function loadWageTypes(ctx: RosterContext): Promise<WageType[]> {
  const rows = (await ctx.sql`SELECT id, code, name, source FROM carecore_payroll_wage_types
    WHERE organization_id = ${ctx.actor.organizationId} ORDER BY code`) as Row[];
  return rows.map((row) => ({
    id: String(row.id),
    code: String(row.code),
    name: String(row.name),
    source: String(row.source) as WageSource,
  }));
}

// Personalnummern der Lohnbuchhaltung je Person.
export async function employeeNumbers(ctx: RosterContext, ids: string[]) {
  if (!ids.length) return new Map<string, string>();
  const rows = (await ctx.sql`SELECT user_id, employee_number FROM carecore_user_profiles
    WHERE user_id = ANY(${ids}::uuid[]) AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  return new Map(rows.map((row) => [String(row.user_id), row.employee_number ? String(row.employee_number) : ""]));
}

export async function saveWageType(ctx: RosterContext, body: Body) {
  if (!managedUnitIds(ctx.access).length) throw forbidden("Lohnarten pflegt die Leitung.");
  const code = text(body.code, "Nummer", 20, true)!;
  const name = text(body.name, "Bezeichnung", 120, true)!;
  const source = oneOf(body.source, WAGE_SOURCES, "Wert");
  const rows = (await ctx.sql`INSERT INTO carecore_payroll_wage_types (organization_id, code, name, source)
    VALUES (${ctx.actor.organizationId}, ${code}, ${name}, ${source}) RETURNING id`) as Row[];
  const id = String(rows[0].id);
  await audit(ctx, "created", "wage_type", id, null, null, { code, name, source });
  return { id };
}

export async function deleteWageType(ctx: RosterContext, id: string) {
  if (!managedUnitIds(ctx.access).length) throw forbidden("Lohnarten pflegt die Leitung.");
  const rows = (await ctx.sql`
    DELETE FROM carecore_payroll_wage_types WHERE id = ${uuid(id, "Lohnart")} AND organization_id = ${ctx.actor.organizationId}
    RETURNING id, code, name, source`) as Row[];
  if (!rows[0]) throw notFound("Lohnart");
  await audit(ctx, "deleted", "wage_type", String(rows[0].id), null, rows[0], null);
  return { id: String(rows[0].id) };
}
