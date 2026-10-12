import "server-only";
import type { Row } from "@/lib/api-context";
import { iso } from "@/lib/api-context";
import type { RosterContext } from "./context";
import { loadEmployees, loadRuleSet, loadShiftTypes, mapShift, monthRange, orgToday, SHIFT_COLUMNS } from "./data";
import { RosterError } from "./errors";
import { deviation, localTime, monthDays } from "./time";
import type { RuleSet, SwapStatus, TimeEntryStatus } from "./types";
import { summarizeMonth, type TimeEntryInfo, type WorkTimeSummary } from "./worktime";
import { loadEntries, unitOptions } from "./schedule";

// Mein Dienstplan (Spec 8.5): nur eigene Dienste aus veröffentlichten Perioden, alle Wohnbereiche.

export type MyShift = {
  id: string;
  unitId: string;
  unitName: string;
  date: string;
  code: string;
  name: string;
  color: string;
  category: string;
  plannedStart: string;
  plannedEnd: string;
  breakMinutes: number;
  version: number;
  swapped: boolean;
  // Tausch anfragen möglich: Arbeitsdienst in der Zukunft, ohne Zeiterfassung und ohne laufenden Tausch.
  tradable: boolean;
  entry: {
    id: string;
    clockIn: string;
    clockOut: string | null;
    breakMinutes: number;
    status: TimeEntryStatus;
    actualMinutes: number | null;
    differenceMinutes: number | null;
    version: number;
  } | null;
  swap: { id: string; status: SwapStatus; with: string } | null;
};

export type MySchedulePayload = {
  year: number;
  month: number;
  today: string;
  timezone: string;
  employee: { id: string; name: string; pensumPercent: number };
  units: Array<{ id: string; name: string }>;
  days: string[];
  shifts: MyShift[];
  summary: WorkTimeSummary | null;
  unplannedEntries: Array<{
    id: string;
    date: string;
    clockIn: string;
    clockOut: string | null;
    actualMinutes: number | null;
    status: TimeEntryStatus;
  }>;
  openEntry: {
    id: string;
    clockIn: string;
    shiftId: string | null;
    breakStartedAt: string | null;
    breakMinutes: number;
    version: number;
  } | null;
  clock: { shiftId: string | null; label: string; canClockIn: boolean; hint: string } | null;
  rules: Pick<RuleSet, "clockInEarliestMinutes" | "deviationThresholdMinutes">;
  changeToken: string;
};

export async function getMySchedule(
  ctx: RosterContext,
  params: { year: number; month: number },
): Promise<MySchedulePayload> {
  const { year, month } = params;
  const { from, to } = monthRange(year, month);
  const [employees, units, types] = await Promise.all([
    loadEmployees(ctx, [ctx.actor.id]),
    unitOptions(ctx),
    loadShiftTypes(ctx),
  ]);
  const employee = employees[ctx.actor.id];
  if (!employee) throw new RosterError("NO_PROFILE", "Für dich ist kein Personalprofil hinterlegt.", 404);
  const homeUnit = employee.unitIds[0] ?? null;
  const rules = await loadRuleSet(ctx, homeUnit);
  const today = await orgToday(ctx, rules.timezone);

  const shiftRows = (await ctx.sql.query(
    `SELECT ${SHIFT_COLUMNS}, p.status AS period_status FROM carecore_roster_shifts s
     JOIN carecore_schedule_periods p ON p.id = s.period_id
     WHERE s.organization_id = $1 AND s.employee_id = $2 AND s.date BETWEEN ($3::date - 1) AND ($4::date + 1)
       AND p.status = 'PUBLISHED'
     ORDER BY s.planned_start`,
    [ctx.actor.organizationId, ctx.actor.id, from, to],
  )) as Row[];
  const shifts = shiftRows.map(mapShift);
  const entries = await loadEntries(ctx, [ctx.actor.id], from, to);
  const openRows = (await ctx.sql`
    SELECT id, clock_in, shift_id, break_started_at, break_minutes, version FROM carecore_time_entries
    WHERE employee_id = ${ctx.actor.id} AND status = 'OPEN' LIMIT 1`) as Row[];
  const swapRows = shifts.length
    ? ((await ctx.sql`
        SELECT sw.id, sw.status, sw.source_shift_id, sw.target_shift_id,
          CASE WHEN sw.requester_id = ${ctx.actor.id} THEN t.display_name ELSE r.display_name END AS other
        FROM carecore_shift_swaps sw
        JOIN carecore_users r ON r.id = sw.requester_id JOIN carecore_users t ON t.id = sw.target_employee_id
        WHERE (sw.source_shift_id = ANY(${shifts.map((s) => s.id)}::uuid[]) OR sw.target_shift_id = ANY(${shifts.map((s) => s.id)}::uuid[]))
          AND sw.status IN ('PENDING_TARGET', 'PENDING_APPROVAL', 'EXECUTED')
        ORDER BY sw.requested_at DESC`) as Row[])
    : [];
  const unitName = new Map(units.map((u) => [u.id, u.name]));
  const inMonth = shifts.filter((s) => s.date >= from && s.date <= to);
  const entryByShift = new Map(entries.filter((e) => e.shiftId).map((e) => [e.shiftId!, e]));
  const summary = summarizeMonth({
    rules,
    employee,
    year,
    month,
    holidays: (
      (await ctx.sql`SELECT to_char(date, 'YYYY-MM-DD') AS d FROM carecore_public_holidays
      WHERE organization_id = ${ctx.actor.organizationId} AND date BETWEEN ${from}::date AND ${to}::date`) as Row[]
    ).map((r) => String(r.d)),
    shifts: inMonth,
    entries,
    types,
    now: new Date().toISOString(),
    today,
  });
  const open = openRows[0];
  // Stempeln: laufender Eintrag, sonst der nächste Dienst ab "clockInEarliestMinutes" vor Beginn.
  const now = Date.now();
  const upcoming = shifts.find(
    (s) =>
      s.category !== "ABSENCE" &&
      !entryByShift.has(s.id) &&
      Date.parse(s.plannedEnd) > now &&
      Date.parse(s.plannedStart) - rules.clockInEarliestMinutes * 60_000 <= now,
  );
  const next = shifts.find((s) => s.category !== "ABSENCE" && Date.parse(s.plannedStart) > now);
  const typeName = (id: string) => types[id]?.name ?? "Dienst";
  const clock = open
    ? {
        shiftId: open.shift_id ? String(open.shift_id) : null,
        label: open.shift_id
          ? `Im Dienst seit ${localTime(iso(open.clock_in) ?? "", rules.timezone)}`
          : `Ungeplanter Einsatz seit ${localTime(iso(open.clock_in) ?? "", rules.timezone)}`,
        canClockIn: false,
        hint: open.break_started_at ? "Pause läuft." : "Ausstempeln nicht vergessen.",
      }
    : upcoming
      ? {
          shiftId: upcoming.id,
          label: `${typeName(upcoming.shiftTypeId)} ${localTime(upcoming.plannedStart, rules.timezone)}–${localTime(upcoming.plannedEnd, rules.timezone)}`,
          canClockIn: true,
          hint: "Einstempeln ist jetzt möglich.",
        }
      : {
          shiftId: null,
          label: next
            ? `Nächster Dienst: ${typeName(next.shiftTypeId)} am ${next.date.slice(8)}.${next.date.slice(5, 7)}. um ${localTime(next.plannedStart, rules.timezone)}`
            : "Kein Dienst geplant",
          canClockIn: true,
          hint: `Einstempeln ist ab ${rules.clockInEarliestMinutes} Minuten vor Dienstbeginn möglich; ohne Dienst gilt es als ungeplanter Einsatz.`,
        };

  return {
    year,
    month,
    today,
    timezone: rules.timezone,
    employee: { id: employee.id, name: employee.name, pensumPercent: employee.pensumPercent },
    units: units.filter((u) => employee.unitIds.includes(u.id)).map((u) => ({ id: u.id, name: u.name })),
    days: monthDays(year, month),
    shifts: inMonth.map((shift) => {
      const type = types[shift.shiftTypeId];
      const entry = entryByShift.get(shift.id);
      const swap = swapRows.find(
        (row) => String(row.source_shift_id) === shift.id || String(row.target_shift_id) === shift.id,
      );
      return {
        id: shift.id,
        unitId: shift.unitId,
        unitName: unitName.get(shift.unitId) ?? "Wohnbereich",
        date: shift.date,
        code: type?.code ?? "?",
        name: type?.name ?? "Dienst",
        color: type?.color ?? "#475569",
        category: shift.category,
        plannedStart: shift.plannedStart,
        plannedEnd: shift.plannedEnd,
        breakMinutes: shift.breakMinutes,
        version: shift.version,
        swapped: !!shift.lastSwapId,
        tradable:
          shift.category !== "ABSENCE" &&
          !entry &&
          Date.parse(shift.plannedStart) > now &&
          !(swap && ["PENDING_TARGET", "PENDING_APPROVAL"].includes(String(swap.status))),
        entry: entry
          ? {
              id: entry.id,
              clockIn: entry.clockIn,
              clockOut: entry.clockOut,
              breakMinutes: entry.breakMinutes,
              status: entry.status,
              actualMinutes: entry.actualMinutes,
              differenceMinutes: entry.clockOut
                ? deviation(
                    { start: shift.plannedStart, end: shift.plannedEnd, breakMinutes: shift.breakMinutes },
                    { clockIn: entry.clockIn, clockOut: entry.clockOut, breakMinutes: entry.breakMinutes },
                  ).differenceMinutes
                : null,
              version: entry.version ?? 1,
            }
          : null,
        swap: swap ? { id: String(swap.id), status: swap.status as SwapStatus, with: String(swap.other) } : null,
      };
    }),
    summary,
    unplannedEntries: entries
      .filter((e: TimeEntryInfo) => !e.shiftId)
      .map((e) => ({
        id: e.id,
        date: e.date,
        clockIn: e.clockIn,
        clockOut: e.clockOut,
        actualMinutes: e.actualMinutes,
        status: e.status,
      })),
    openEntry: open
      ? {
          id: String(open.id),
          clockIn: iso(open.clock_in) ?? "",
          shiftId: open.shift_id ? String(open.shift_id) : null,
          breakStartedAt: iso(open.break_started_at),
          breakMinutes: Number(open.break_minutes),
          version: Number(open.version),
        }
      : null,
    clock,
    rules: {
      clockInEarliestMinutes: rules.clockInEarliestMinutes,
      deviationThresholdMinutes: rules.deviationThresholdMinutes,
    },
    changeToken: await myChangeToken(ctx, year, month),
  };
}

// Vergleichswert fürs Polling: eigene veröffentlichte Dienste, Zeiteinträge und Tauschanfragen des Monats.
export async function myChangeToken(ctx: RosterContext, year: number, month: number) {
  const { from, to } = monthRange(year, month);
  const rows = (await ctx.sql`
    SELECT md5(
      COALESCE((SELECT string_agg(s.id::text || ':' || s.version, ',' ORDER BY s.id) FROM carecore_roster_shifts s
        JOIN carecore_schedule_periods p ON p.id = s.period_id
        WHERE s.employee_id = ${ctx.actor.id} AND p.status = 'PUBLISHED' AND s.date BETWEEN (${from}::date - 1) AND (${to}::date + 1)), '') || '|' ||
      COALESCE((SELECT string_agg(e.id::text || ':' || e.version, ',' ORDER BY e.id) FROM carecore_time_entries e
        WHERE e.employee_id = ${ctx.actor.id} AND (e.date BETWEEN ${from}::date AND ${to}::date OR e.status = 'OPEN')), '') || '|' ||
      COALESCE((SELECT string_agg(w.id::text || ':' || w.status, ',' ORDER BY w.id) FROM carecore_shift_swaps w
        WHERE (w.requester_id = ${ctx.actor.id} OR w.target_employee_id = ${ctx.actor.id}) AND w.updated_at > NOW() - INTERVAL '60 days'), '')
    ) AS token`) as Row[];
  return String(rows[0].token);
}
