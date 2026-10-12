import { iso, type ApiContext, type Row } from "@/lib/api-context";
import { plannedInterval } from "@/lib/roster/time";
import {
  type ChecklistKey,
  type HandoverStatus,
  type MyShift,
  type ShiftHistory,
  type ShiftPulse,
} from "@/lib/shift-shared";

export const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function orgTimezone({ sql, actor }: ApiContext) {
  const rows = (await sql`SELECT timezone FROM carecore_organizations WHERE id = ${actor.organizationId}`) as Row[];
  return String(rows[0]?.timezone ?? "Europe/Zurich");
}

export const clock = (value: string, tz: string) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(value));
export const localDate = (value: string | number, tz: string) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(value),
  );
export const residentLabel = (row: Row) =>
  row.resident_name ? `${row.resident_name}${row.room ? ` · ${row.room}` : ""}` : "";

// Ohne geplanten Dienst: Zeitfenster des Diensttyps, dessen Beginn am nächsten am Einstempeln liegt.
async function unplannedWindow({ sql, actor }: ApiContext, clockIn: string, tz: string) {
  const types = (await sql`
    SELECT start_time, end_time FROM carecore_shift_types
    WHERE organization_id = ${actor.organizationId} AND active AND category <> 'ABSENCE'`) as Row[];
  const day = localDate(clockIn, tz);
  const windows = types.flatMap((type) =>
    [-1, 0].map((offset) => {
      const date = new Date(Date.parse(`${day}T12:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10);
      const { start, end } = plannedInterval(
        date,
        String(type.start_time).slice(0, 5),
        String(type.end_time).slice(0, 5),
        tz,
      );
      return { start: start.toISOString(), end: end.toISOString() };
    }),
  );
  const at = Date.parse(clockIn);
  const best = windows
    .filter((w) => Date.parse(w.end) > at)
    .sort((a, b) => Math.abs(Date.parse(a.start) - at) - Math.abs(Date.parse(b.start) - at))[0];
  return best ?? { start: clockIn, end: new Date(at + 8 * 3_600_000).toISOString() };
}

// Laufender Dienst (eingestempelt oder geplant und einstempelbar) und der nächste geplante Dienst,
// aus dem veröffentlichten Dienstplan und der Zeiterfassung.
export async function myShifts(ctx: ApiContext): Promise<{ current: MyShift | null; next: MyShift | null }> {
  const { sql, actor } = ctx;
  const [open, planned, tz, rules] = await Promise.all([
    sql`SELECT e.id, e.clock_in, e.care_unit_id AS entry_unit, s.id AS shift_id, st.name, s.planned_start AS starts_at, s.planned_end AS ends_at, s.care_unit_id, cu.name AS care_unit, ecu.name AS entry_unit_name,
          p.job_title
        FROM carecore_time_entries e
        LEFT JOIN carecore_roster_shifts s ON s.id = e.shift_id
        LEFT JOIN carecore_shift_types st ON st.id = s.shift_type_id
        LEFT JOIN carecore_care_units cu ON cu.id = s.care_unit_id
        LEFT JOIN carecore_care_units ecu ON ecu.id = e.care_unit_id
        LEFT JOIN carecore_user_profiles p ON p.user_id = e.employee_id
        WHERE e.employee_id = ${actor.id} AND e.organization_id = ${actor.organizationId} AND e.status = 'OPEN' LIMIT 1` as Promise<
      Row[]
    >,
    sql`SELECT s.id AS shift_id, st.name, s.planned_start AS starts_at, s.planned_end AS ends_at, s.care_unit_id, cu.name AS care_unit, p.job_title
        FROM carecore_roster_shifts s
        JOIN carecore_schedule_periods sp ON sp.id = s.period_id AND sp.status = 'PUBLISHED'
        JOIN carecore_shift_types st ON st.id = s.shift_type_id
        LEFT JOIN carecore_care_units cu ON cu.id = s.care_unit_id
        LEFT JOIN carecore_user_profiles p ON p.user_id = s.employee_id
        WHERE s.employee_id = ${actor.id} AND s.organization_id = ${actor.organizationId} AND s.category <> 'ABSENCE'
          AND s.planned_end > NOW() AND NOT EXISTS (SELECT 1 FROM carecore_time_entries te WHERE te.shift_id = s.id)
        ORDER BY s.planned_start LIMIT 3` as Promise<Row[]>,
    orgTimezone(ctx),
    sql`SELECT COALESCE((SELECT clock_in_earliest_minutes FROM carecore_rule_sets
          WHERE organization_id = ${actor.organizationId} AND care_unit_id IS NULL LIMIT 1), 60) AS earliest` as Promise<
      Row[]
    >,
  ]);
  const earliest = Number(rules[0]?.earliest ?? 60) * 60_000;
  const toShift = (row: Row, checkedInAt: string | null): MyShift => ({
    assignmentId: String(row.shift_id),
    shiftId: String(row.shift_id),
    name: String(row.name),
    startsAt: iso(row.starts_at) ?? "",
    endsAt: iso(row.ends_at) ?? "",
    careUnitId: (row.care_unit_id as string | null) ?? null,
    careUnit: (row.care_unit as string | null) ?? null,
    role: (row.job_title as string | null) ?? null,
    status: checkedInAt ? "active" : "planned",
    checkedInAt,
    checkedOutAt: null,
  });
  let current: MyShift | null = null;
  const entry = open[0];
  if (entry?.shift_id) current = { ...toShift(entry, iso(entry.clock_in)), assignmentId: String(entry.id) };
  else if (entry) {
    const clockIn = iso(entry.clock_in) ?? "";
    const window = await unplannedWindow(ctx, clockIn, tz);
    current = {
      assignmentId: String(entry.id),
      shiftId: String(entry.id),
      name: "Ungeplanter Einsatz",
      startsAt: window.start,
      endsAt: window.end,
      careUnitId: (entry.entry_unit as string | null) ?? null,
      careUnit: (entry.entry_unit_name as string | null) ?? null,
      role: (entry.job_title as string | null) ?? null,
      status: "active",
      checkedInAt: clockIn,
      checkedOutAt: null,
    };
  }
  const startable = entry
    ? undefined
    : planned.find((row) => Date.parse(iso(row.starts_at) ?? "") - earliest <= Date.now());
  if (startable) current = toShift(startable, null);
  const nextRow = planned.find((row) => row !== startable && Date.parse(iso(row.starts_at) ?? "") > Date.now());
  return { current, next: nextRow ? toShift(nextRow, null) : null };
}

export async function primaryUnit({ sql, actor }: ApiContext) {
  const rows = (await sql`
    SELECT p.primary_care_unit_id AS id, cu.name FROM carecore_user_profiles p
    LEFT JOIN carecore_care_units cu ON cu.id = p.primary_care_unit_id WHERE p.user_id = ${actor.id} LIMIT 1`) as Row[];
  return rows[0]?.id ? { id: String(rows[0].id), name: String(rows[0].name) } : null;
}

// Anwesend = eingestempelt; geplant = veröffentlichte Dienste, die gerade laufen.
export async function staffing({ sql, actor }: ApiContext, unitId: string | null) {
  const rows = (await sql`
    SELECT
      (SELECT COUNT(*) FROM carecore_time_entries e
        WHERE e.organization_id = ${actor.organizationId} AND e.status = 'OPEN'
          AND (${unitId}::uuid IS NULL OR e.care_unit_id = ${unitId}::uuid))::int AS present,
      (SELECT COUNT(*) FROM carecore_roster_shifts s JOIN carecore_schedule_periods p ON p.id = s.period_id AND p.status = 'PUBLISHED'
        WHERE s.organization_id = ${actor.organizationId} AND s.category <> 'ABSENCE'
          AND s.planned_start <= NOW() AND s.planned_end > NOW()
          AND (${unitId}::uuid IS NULL OR s.care_unit_id = ${unitId}::uuid))::int AS planned`) as Row[];
  return { present: Number(rows[0]?.present ?? 0), planned: Number(rows[0]?.planned ?? 0) };
}

export async function residentCount({ sql, actor }: ApiContext, unitId: string | null) {
  const rows = (await sql`
    SELECT COUNT(*)::int AS n FROM carecore_residents r
    WHERE r.organization_id = ${actor.organizationId} AND r.status = 'active'
      AND (${unitId}::uuid IS NULL OR EXISTS (
        SELECT 1 FROM carecore_resident_stays st WHERE st.resident_id = r.id AND st.ended_at IS NULL AND st.care_unit_id = ${unitId}::uuid))`) as Row[];
  return Number(rows[0]?.n ?? 0);
}

export async function openTaskCount({ sql, actor }: ApiContext) {
  const rows = (await sql`
    SELECT COUNT(*)::int AS n FROM carecore_tasks
    WHERE organization_id = ${actor.organizationId} AND assigned_to = ${actor.id} AND status IN ('open', 'in_progress', 'escalated')
      AND (due_at IS NULL OR due_at < NOW() + INTERVAL '12 hours')`) as Row[];
  return Number(rows[0]?.n ?? 0);
}

export async function shiftPulse(ctx: ApiContext): Promise<ShiftPulse> {
  const [{ current, next }, tz, unit] = await Promise.all([myShifts(ctx), orgTimezone(ctx), primaryUnit(ctx)]);
  const unitId = current?.careUnitId ?? unit?.id ?? null;
  const [residents, openTasks, staff] = await Promise.all([
    residentCount(ctx, unitId),
    openTaskCount(ctx),
    staffing(ctx, unitId),
  ]);
  const label = current
    ? `${current.name} · ${clock(current.startsAt, tz)}–${clock(current.endsAt, tz)}`
    : next
      ? `Nächster Dienst: ${next.name}, ${new Intl.DateTimeFormat("de-CH", { timeZone: tz, weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(next.startsAt))} ${clock(next.startsAt, tz)}`
      : "Kein Dienst geplant";
  const unitName = current?.careUnit ?? unit?.name ?? "Gesamtes Haus";
  return {
    label,
    detail: current?.checkedInAt ? `Eingecheckt · ${unitName}` : `Live-Überblick · ${unitName}`,
    residents,
    openTasks,
    staffPresent: staff.present,
    staffPlanned: staff.planned,
  };
}

export async function shiftHistory(ctx: ApiContext, params: URLSearchParams): Promise<ShiftHistory> {
  const { sql, actor } = ctx;
  const days = [30, 90, 180, 365].includes(Number(params.get("days"))) ? Number(params.get("days")) : 90;
  // Zeiteinträge, vergangene Dienste ohne Zeiterfassung und Abwesenheiten aus dem veröffentlichten Plan.
  const rows = (await sql`
    WITH items AS (
      SELECT e.id, COALESCE(st.name, 'Ungeplanter Einsatz') AS name, COALESCE(s.planned_start, e.clock_in) AS starts_at,
        COALESCE(s.planned_end, e.clock_out, e.clock_in) AS ends_at, e.clock_in AS checked_in_at, e.clock_out AS checked_out_at,
        cu.name AS care_unit, CASE WHEN e.status IN ('COMPLETE', 'APPROVED') THEN 'completed' ELSE 'open' END AS status,
        e.handover_status, e.checklist, e.check_in_note, e.check_out_note
      FROM carecore_time_entries e
      LEFT JOIN carecore_roster_shifts s ON s.id = e.shift_id
      LEFT JOIN carecore_shift_types st ON st.id = s.shift_type_id
      LEFT JOIN carecore_care_units cu ON cu.id = e.care_unit_id
      WHERE e.employee_id = ${actor.id} AND e.organization_id = ${actor.organizationId}
        AND e.clock_in > NOW() - make_interval(days => ${days})
      UNION ALL
      SELECT s.id, st.name, s.planned_start, s.planned_end, NULL, NULL, cu.name,
        CASE WHEN s.category = 'ABSENCE' THEN 'absent' ELSE 'open' END, NULL, '[]'::jsonb, NULL, NULL
      FROM carecore_roster_shifts s
      JOIN carecore_schedule_periods p ON p.id = s.period_id AND p.status = 'PUBLISHED'
      JOIN carecore_shift_types st ON st.id = s.shift_type_id
      LEFT JOIN carecore_care_units cu ON cu.id = s.care_unit_id
      WHERE s.employee_id = ${actor.id} AND s.organization_id = ${actor.organizationId}
        AND s.planned_end < NOW() AND s.planned_start > NOW() - make_interval(days => ${days})
        AND NOT EXISTS (SELECT 1 FROM carecore_time_entries te WHERE te.shift_id = s.id)
    )
    SELECT items.*,
      (SELECT COUNT(*) FROM carecore_documentation_entries d WHERE d.author_user_id = ${actor.id} AND d.created_at >= win.f AND d.created_at < win.t)::int AS docs,
      (SELECT COUNT(*) FROM carecore_vital_measurements v WHERE v.measured_by = ${actor.id} AND v.created_at >= win.f AND v.created_at < win.t)::int AS vitals,
      (SELECT COUNT(*) FROM carecore_medication_administrations m WHERE m.administered_by = ${actor.id} AND m.administered_at >= win.f AND m.administered_at < win.t)::int AS meds,
      (SELECT COUNT(*) FROM carecore_tasks t WHERE t.completed_by = ${actor.id} AND t.completed_at >= win.f AND t.completed_at < win.t)::int AS tasks,
      (SELECT COUNT(*) FROM carecore_handovers h WHERE h.author_user_id = ${actor.id} AND h.created_at >= win.f AND h.created_at < win.t)::int AS handovers
    FROM items
    CROSS JOIN LATERAL (SELECT COALESCE(items.checked_in_at, items.starts_at) AS f,
      COALESCE(items.checked_out_at, items.ends_at) AS t) win
    ORDER BY items.starts_at DESC LIMIT 200`) as Row[];
  const entries = rows.map((row) => ({
    assignmentId: String(row.id),
    name: String(row.name),
    startsAt: iso(row.starts_at) ?? "",
    endsAt: iso(row.ends_at) ?? "",
    checkedInAt: iso(row.checked_in_at),
    checkedOutAt: iso(row.checked_out_at),
    careUnit: (row.care_unit as string | null) ?? null,
    status: row.status as "completed" | "open" | "absent",
    handoverStatus: (row.handover_status as HandoverStatus | null) ?? null,
    checklist: (Array.isArray(row.checklist) ? row.checklist : []) as ChecklistKey[],
    checkInNote: (row.check_in_note as string | null) ?? null,
    checkOutNote: (row.check_out_note as string | null) ?? null,
    counts: {
      documentation: Number(row.docs),
      vitals: Number(row.vitals),
      medication: Number(row.meds),
      tasks: Number(row.tasks),
      handover: Number(row.handovers),
    },
  }));
  const worked = entries.filter((entry) => entry.status !== "absent");
  return {
    entries,
    totals: {
      shifts: worked.length,
      completed: worked.filter((entry) => entry.status === "completed").length,
      documentation: worked.reduce((sum, entry) => sum + entry.counts.documentation, 0),
      open: worked.filter((entry) => entry.status === "open").length,
    },
  };
}
