import { iso, type ApiContext, type Row } from "@/lib/api-context";
import { readTerms } from "@/lib/settings";
import { countOf } from "@/lib/terminology";
import { listRound } from "@/lib/medication-round";
import type { RoundKey } from "@/lib/medication-shared";
import { type ShiftHint, type ShiftOverview, type TimelineItem } from "@/lib/shift-shared";
import {
  localDate,
  myShifts,
  orgTimezone,
  primaryUnit,
  clock,
  residentCount,
  staffing,
  openTaskCount,
  residentLabel,
} from "./shift";

export async function dayBounds({ sql, actor }: ApiContext, anchor: string | null) {
  const rows = (await sql`
    SELECT (d::timestamp AT TIME ZONE tz) AS day_from, ((d + 1)::timestamp AT TIME ZONE tz) AS day_to
    FROM (SELECT timezone AS tz, (COALESCE(${anchor}::timestamptz, NOW()) AT TIME ZONE timezone)::date AS d
      FROM carecore_organizations WHERE id = ${actor.organizationId}) x`) as Row[];
  return { from: iso(rows[0].day_from) ?? "", to: iso(rows[0].day_to) ?? "" };
}

export async function medicationItems(
  ctx: ApiContext,
  window: { from: string; to: string },
  unitName: string | null,
  tz: string,
): Promise<TimelineItem[]> {
  const from = Date.parse(window.from);
  const to = Date.parse(window.to);
  // The night round of a day also covers the early hours of the next day.
  const calls: Array<[RoundKey, string]> = [["night", localDate(from - 86_400_000, tz)]];
  for (let day = localDate(from, tz); day <= localDate(to - 1, tz);) {
    for (const round of ["morning", "noon", "evening", "night"] as RoundKey[]) calls.push([round, day]);
    const nextDay = new Date(`${day}T12:00:00Z`);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    day = nextDay.toISOString().slice(0, 10);
  }
  const [rounds, t] = await Promise.all([
    Promise.all(calls.map(([round, day]) => listRound(ctx, round, day))),
    readTerms(ctx),
  ]);
  const slots = new Map<
    string,
    { at: string; total: number; documented: number; changed: number; residents: Set<string> }
  >();
  for (const dose of rounds.flatMap((round) => round.doses)) {
    const at = Date.parse(dose.scheduledAt);
    if (at < from || at >= to || (unitName && dose.careUnit !== unitName)) continue;
    const slot = slots.get(dose.scheduledAt) ?? {
      at: dose.scheduledAt,
      total: 0,
      documented: 0,
      changed: 0,
      residents: new Set<string>(),
    };
    slot.total += 1;
    if (dose.status !== "scheduled") slot.documented += 1;
    if (dose.orderChangedRecently) slot.changed += 1;
    slot.residents.add(dose.residentId);
    slots.set(dose.scheduledAt, slot);
  }
  return [...slots.values()].map((slot) => {
    const done = slot.documented === slot.total;
    return {
      id: `medication-${slot.at}`,
      kind: "medication",
      at: slot.at,
      title: "Medikamentenrunde",
      detail: `${countOf(slot.residents.size, t)} · ${slot.total} ${slot.total === 1 ? "Gabe" : "Gaben"} · ${slot.documented} dokumentiert${slot.changed ? ` · ${slot.changed} Anpassung${slot.changed > 1 ? "en" : ""}` : ""}`,
      tone: slot.changed ? "attention" : "info",
      done,
      overdue: !done && Date.parse(slot.at) < Date.now() - 30 * 60_000,
      href: "/medikation/runde",
    } satisfies TimelineItem;
  });
}

export async function shiftOverview(ctx: ApiContext, params: URLSearchParams): Promise<ShiftOverview> {
  const { sql, actor } = ctx;
  const [{ current, next }, tz, primary, careUnits] = await Promise.all([
    myShifts(ctx),
    orgTimezone(ctx),
    primaryUnit(ctx),
    sql`SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
      WHERE si.organization_id = ${actor.organizationId} AND cu.active = TRUE ORDER BY cu.name` as Promise<Row[]>,
  ]);
  const units = careUnits.map((row) => ({ id: String(row.id), name: String(row.name) }));
  const requestedUnit = params.get("careUnitId");
  const unit =
    requestedUnit === "all"
      ? null
      : (units.find((u) => u.id === requestedUnit) ??
        (current?.careUnitId ? { id: current.careUnitId, name: current.careUnit ?? "" } : primary));
  const unitId = unit?.id ?? null;

  const fullDay = params.get("range") === "day" || !current;
  const window =
    current && !fullDay
      ? {
          from: current.startsAt,
          to: current.endsAt,
          label: `${current.name} · ${clock(current.startsAt, tz)}–${clock(current.endsAt, tz)}`,
        }
      : { ...(await dayBounds(ctx, current?.startsAt ?? null)), label: "Ganzer Tag" };

  const [
    taskRows,
    woundRows,
    appointmentRows,
    noteRows,
    vitalRows,
    orderRows,
    medication,
    residents,
    staff,
    openTasks,
  ] = await Promise.all([
    sql`
        SELECT t.id, t.title, t.category, t.priority, t.status, t.due_at, t.document_on_completion,
          r.first_name || ' ' || r.last_name AS resident_name, ro.name AS room
        FROM carecore_tasks t
        LEFT JOIN carecore_residents r ON r.id = t.resident_id
        LEFT JOIN LATERAL (SELECT room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) st ON TRUE
        LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
        WHERE t.organization_id = ${actor.organizationId} AND t.status <> 'cancelled' AND t.due_at IS NOT NULL
          AND (t.assigned_to = ${actor.id} OR (t.assigned_to IS NULL AND t.team_visible AND (${unitId}::uuid IS NULL OR t.care_unit_id = ${unitId}::uuid)))
          AND ((t.due_at >= ${window.from} AND t.due_at < ${window.to}) OR (t.status IN ('open', 'in_progress', 'escalated') AND t.due_at < ${window.from})
            OR (t.status IN ('completed', 'partial', 'skipped') AND t.completed_at >= ${window.from} AND t.completed_at < ${window.to}))
        ORDER BY t.due_at LIMIT 100` as Promise<Row[]>,
    sql`
        SELECT w.id, w.title, r.first_name || ' ' || r.last_name AS resident_name, ro.name AS room, last.observed AS last_at,
          COALESCE(last.observed, w.discovered_at, w.created_at) + make_interval(days => w.care_interval_days) AS due_at,
          EXISTS (SELECT 1 FROM carecore_wound_entries e WHERE e.wound_id = w.id AND e.observed_at >= ${window.from} AND e.observed_at < ${window.to}) AS done
        FROM carecore_wounds w
        JOIN carecore_residents r ON r.id = w.resident_id AND r.organization_id = ${actor.organizationId} AND r.status = 'active'
        LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) st ON TRUE
        LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
        LEFT JOIN LATERAL (SELECT MAX(observed_at) AS observed FROM carecore_wound_entries WHERE wound_id = w.id) last ON TRUE
        WHERE w.status IN ('active', 'healing') AND w.care_interval_days IS NOT NULL
          AND (${unitId}::uuid IS NULL OR st.care_unit_id = ${unitId}::uuid)` as Promise<Row[]>,
    sql`
        SELECT a.id, a.title, a.category, a.starts_at, a.status, a.location,
          r.first_name || ' ' || r.last_name AS resident_name, ro.name AS room, cu.name AS unit_name
        FROM carecore_resident_appointments a
        LEFT JOIN carecore_residents r ON r.id = a.resident_id
        LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) st ON TRUE
        LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
        LEFT JOIN carecore_care_units cu ON cu.id = a.care_unit_id
        WHERE a.organization_id = ${actor.organizationId} AND a.status <> 'cancelled'
          AND a.starts_at >= ${window.from} AND a.starts_at < ${window.to}
          AND (${unitId}::uuid IS NULL OR a.care_unit_id = ${unitId}::uuid OR st.care_unit_id = ${unitId}::uuid)
        ORDER BY a.starts_at LIMIT 50` as Promise<Row[]>,
    sql`
        SELECT h.id, h.content, h.priority, r.first_name || ' ' || r.last_name AS resident_name
        FROM carecore_handovers h LEFT JOIN carecore_residents r ON r.id = h.resident_id
        WHERE h.organization_id = ${actor.organizationId} AND h.created_at > NOW() - INTERVAL '72 hours'
          AND h.author_user_id IS DISTINCT FROM ${actor.id}
          AND NOT EXISTS (SELECT 1 FROM carecore_handover_reads x WHERE x.handover_id = h.id AND x.user_id = ${actor.id})
          AND (${unitId}::uuid IS NULL OR h.care_unit_id IS NULL OR h.care_unit_id = ${unitId}::uuid)
        ORDER BY CASE h.priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, h.created_at DESC` as Promise<
      Row[]
    >,
    sql`
        SELECT v.id, v.metric, v.value, v.unit, r.first_name || ' ' || r.last_name AS resident_name
        FROM carecore_vital_measurements v
        JOIN carecore_residents r ON r.id = v.resident_id AND r.organization_id = ${actor.organizationId}
        LEFT JOIN LATERAL (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) st ON TRUE
        WHERE v.status = 'critical' AND v.measured_at > NOW() - INTERVAL '12 hours'
          AND (${unitId}::uuid IS NULL OR st.care_unit_id = ${unitId}::uuid)
        ORDER BY v.measured_at DESC LIMIT 2` as Promise<Row[]>,
    sql`
        SELECT o.id, TRIM(CONCAT_WS(' ', m.name, m.strength)) AS medication, COALESCE(o.dosage->>'amount', '') AS amount,
          r.first_name || ' ' || r.last_name AS resident_name
        FROM carecore_medication_orders o
        JOIN carecore_residents r ON r.id = o.resident_id AND r.organization_id = ${actor.organizationId} AND r.status = 'active'
        LEFT JOIN carecore_medications m ON m.id = o.medication_id
        LEFT JOIN LATERAL (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) st ON TRUE
        WHERE o.status = 'active' AND o.updated_at > NOW() - INTERVAL '24 hours'
          AND (${unitId}::uuid IS NULL OR st.care_unit_id = ${unitId}::uuid)
        ORDER BY o.updated_at DESC LIMIT 2` as Promise<Row[]>,
    medicationItems(ctx, window, unit?.name ?? null, tz),
    residentCount(ctx, unitId),
    staffing(ctx, unitId),
    openTaskCount(ctx),
  ]);

  const now = Date.now();
  const tone = (priority: unknown) =>
    priority === "critical" ? "critical" : priority === "high" ? "attention" : ("info" as const);
  const timeline: TimelineItem[] = [
    ...taskRows.map((row): TimelineItem => {
      const done = ["completed", "partial", "skipped"].includes(String(row.status));
      return {
        id: `task-${row.id}`,
        kind: "task",
        at: iso(row.due_at) ?? "",
        title: String(row.title),
        detail: [residentLabel(row), row.category].filter(Boolean).join(" · "),
        tone: tone(row.priority),
        done,
        overdue: !done && Date.parse(String(iso(row.due_at))) < now,
        href: `/betrieb/aufgaben?task=${row.id}`,
        taskId: String(row.id),
        documentOnCompletion: Boolean(row.document_on_completion),
      };
    }),
    ...medication,
    ...woundRows.flatMap((row): TimelineItem[] => {
      const dueAt = iso(row.due_at) ?? "";
      if (!row.done && Date.parse(dueAt) >= Date.parse(window.to)) return [];
      return [
        {
          id: `wound-${row.id}`,
          kind: "wound",
          at: row.done ? (iso(row.last_at) ?? dueAt) : dueAt,
          title: "Wundversorgung",
          detail: `${residentLabel(row)} · ${row.title}`,
          tone: "attention",
          done: Boolean(row.done),
          overdue: !row.done && Date.parse(dueAt) < now,
          href: `/wundmanagement?wound=${row.id}`,
        },
      ];
    }),
    ...appointmentRows.map((row): TimelineItem => ({
      id: `appointment-${row.id}`,
      kind: "appointment",
      at: iso(row.starts_at) ?? "",
      title: String(row.title),
      detail: [residentLabel(row) || row.unit_name, row.category, row.location].filter(Boolean).join(" · "),
      tone: "info",
      done: row.status === "completed",
      overdue: false,
      href: "/carecore-one/kalender",
    })),
  ].sort((a, b) => Date.parse(a.at) - Date.parse(b.at));

  const hints: ShiftHint[] = [
    ...noteRows.slice(0, 2).map((row): ShiftHint => ({
      id: `note-${row.id}`,
      tone: row.priority === "critical" ? "critical" : row.priority === "high" ? "attention" : "info",
      title: `Übergabe${row.resident_name ? ` · ${row.resident_name}` : ""}`,
      text: String(row.content),
      href: "/betrieb/uebergabe",
    })),
    ...vitalRows.map((row): ShiftHint => ({
      id: `vital-${row.id}`,
      tone: "critical",
      title: `Kritischer Vitalwert · ${row.resident_name}`,
      text: `${row.metric} ${String(Number(row.value)).replace(".", ",")} ${row.unit}`,
      href: "/vitalwerte",
    })),
    ...orderRows.map((row): ShiftHint => ({
      id: `order-${row.id}`,
      tone: "attention",
      title: `Verordnung geändert · ${row.resident_name}`,
      text: `${row.medication}${row.amount ? ` ${row.amount}` : ""} – Wirkung beobachten.`,
      href: "/medikation",
    })),
  ];
  const overdue = timeline.filter((item) => item.overdue).length;
  if (overdue)
    hints.push({
      id: "overdue",
      tone: "attention",
      title: `${overdue} ${overdue === 1 ? "Punkt ist" : "Punkte sind"} überfällig`,
      text: "Im Tagesablauf rot markiert – bitte erledigen oder neu planen.",
      href: "/betrieb/aufgaben",
    });

  return {
    current,
    next,
    window,
    careUnit: { id: unitId, name: unit?.name ?? "Gesamtes Haus" },
    timeline,
    hints: hints.slice(0, 5),
    stats: {
      residents,
      tasks: taskRows.length,
      done: timeline.filter((item) => item.done).length,
      total: timeline.length,
      staffPresent: staff.present,
      staffPlanned: staff.planned,
    },
    careUnits: units,
    unreadHandover: noteRows.length,
    openTasks,
  };
}
