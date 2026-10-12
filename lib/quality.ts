import { randomUUID } from "node:crypto";
import { assertEventType, readEventTypes } from "@/lib/quality-types";
import {
  ApiError,
  assertResident,
  assertUuid,
  iso,
  text,
  auditStatement,
  type ApiContext,
  type Row,
} from "@/lib/api-context";
import { staffOf } from "@/lib/care-planning";
import { notifyStatements } from "@/lib/notify";
import { hasPermission } from "@/lib/server-data";
import {
  ACTION_STATUS,
  EFFECTIVENESS,
  EVENT_STATUS,
  SEVERITIES,
  type ActionStatus,
  type Effectiveness,
  type EventStatus,
  type Option,
  type QualityAction,
  type QualityActionsPayload,
  type QualityEvent,
  type QualityEventsPayload,
  type Severity,
} from "@/lib/quality-shared";
import { workflowTaskStatement } from "@/lib/quality-workflows";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const canManageQuality = (ctx: ApiContext) => hasPermission(ctx.actor, "quality.manage");

function requireManage(ctx: ApiContext) {
  if (!canManageQuality(ctx)) throw new ApiError("Nur das Qualitätsmanagement darf das ändern.", 403);
}

async function careUnitsOf(ctx: ApiContext): Promise<Option[]> {
  const rows = (await ctx.sql`
    SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
    WHERE s.organization_id = ${ctx.actor.organizationId} AND cu.active ORDER BY cu.name`) as Row[];
  return rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
}

async function assertCareUnit(ctx: ApiContext, value: unknown) {
  if (!value) return null;
  const id = assertUuid(value, "Wohnbereich");
  const rows = await ctx.sql`
    SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
    WHERE cu.id = ${id} AND s.organization_id = ${ctx.actor.organizationId}`;
  if (!rows[0]) throw new ApiError("Wohnbereich nicht gefunden.", 404);
  return id;
}

async function assertStaff(ctx: ApiContext, value: unknown) {
  if (!value) return null;
  const id = assertUuid(value, "Verantwortliche Person");
  const rows = await ctx.sql`
    SELECT p.user_id FROM carecore_user_profiles p JOIN carecore_users u ON u.id = p.user_id AND u.active
    WHERE p.user_id = ${id} AND p.organization_id = ${ctx.actor.organizationId}`;
  if (!rows[0])
    throw new ApiError("Die verantwortliche Person gehört nicht zu dieser Organisation oder ist nicht aktiv.");
  return id;
}

async function qualityManagers(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT u.id FROM carecore_users u
    JOIN carecore_user_profiles p ON p.user_id = u.id
    JOIN carecore_roles r ON r.key = u.role
    WHERE p.organization_id = ${ctx.actor.organizationId} AND u.active AND r.permissions ? 'quality.manage'`) as Row[];
  return rows.map((row) => String(row.id));
}

// ------------------------------------------------------------------ events

function mapEvent(row: Row): QualityEvent {
  return {
    id: String(row.id),
    title: String(row.title ?? row.type),
    type: String(row.type),
    severity: (row.severity as Severity) in SEVERITIES ? (row.severity as Severity) : "attention",
    status: row.status as EventStatus,
    occurredAt: iso(row.occurred_at) ?? "",
    description: String(row.description),
    immediateAction: (row.immediate_action as string | null) ?? null,
    residentId: (row.resident_id as string | null) ?? null,
    residentName: (row.resident_name as string | null) ?? null,
    careUnitId: (row.care_unit_id as string | null) ?? null,
    careUnit: (row.care_unit as string | null) ?? null,
    reportedBy: (row.reported_by_name as string | null) ?? null,
    ownerId: (row.owner_user_id as string | null) ?? null,
    ownerName: (row.owner_name as string | null) ?? null,
    resolution: (row.resolution as string | null) ?? null,
    resolvedAt: iso(row.resolved_at),
    actions: Number(row.actions ?? 0),
    openActions: Number(row.open_actions ?? 0),
    followUps: Number(row.follow_ups ?? 0),
    followUpsDone: Number(row.follow_ups_done ?? 0),
  };
}

export async function eventsData(ctx: ApiContext): Promise<QualityEventsPayload> {
  const manager = canManageQuality(ctx);
  const [rows, stats, residents, careUnits, staff, workflowRows, eventTypes] = await Promise.all([
    ctx.sql`
      SELECT e.*, NULLIF(TRIM(r.first_name || ' ' || r.last_name), '') AS resident_name, cu.name AS care_unit,
        rep.display_name AS reported_by_name, own.display_name AS owner_name,
        (SELECT COUNT(*)::int FROM carecore_quality_actions a WHERE a.quality_event_id = e.id AND a.status <> 'cancelled') AS actions,
        (SELECT COUNT(*)::int FROM carecore_quality_actions a WHERE a.quality_event_id = e.id AND a.status IN ('open', 'planned')) AS open_actions,
        (SELECT COUNT(*)::int FROM carecore_tasks t WHERE t.quality_event_id = e.id AND t.status <> 'cancelled') AS follow_ups,
        (SELECT COUNT(*)::int FROM carecore_tasks t WHERE t.quality_event_id = e.id
          AND t.status IN ('completed', 'partial', 'skipped')) AS follow_ups_done
      FROM carecore_quality_events e
      LEFT JOIN carecore_residents r ON r.id = e.resident_id
      LEFT JOIN carecore_care_units cu ON cu.id = e.care_unit_id
      LEFT JOIN carecore_users rep ON rep.id = e.reported_by
      LEFT JOIN carecore_users own ON own.id = e.owner_user_id
      WHERE e.organization_id = ${ctx.actor.organizationId} AND (${manager} OR e.reported_by = ${ctx.actor.id})
      ORDER BY (e.status IN ('open', 'investigating')) DESC, e.occurred_at DESC
      LIMIT 300` as Promise<Row[]>,
    ctx.sql`
      SELECT
        COUNT(*) FILTER (WHERE e.occurred_at >= date_trunc('year', NOW() AT TIME ZONE org.tz) AT TIME ZONE org.tz)::int AS this_year,
        COUNT(*) FILTER (WHERE e.occurred_at >= (date_trunc('year', NOW() AT TIME ZONE org.tz) - INTERVAL '1 year') AT TIME ZONE org.tz
          AND e.occurred_at < NOW() - INTERVAL '1 year')::int AS last_year,
        COUNT(*) FILTER (WHERE e.severity = 'critical' AND e.status IN ('open', 'investigating'))::int AS critical_open,
        COUNT(*) FILTER (WHERE e.status = 'investigating')::int AS investigating,
        COUNT(*) FILTER (WHERE (e.created_at AT TIME ZONE org.tz)::date = (NOW() AT TIME ZONE org.tz)::date)::int AS new_today,
        COUNT(*) FILTER (WHERE e.occurred_at >= date_trunc('year', NOW() AT TIME ZONE org.tz) AT TIME ZONE org.tz
          AND e.status IN ('resolved', 'closed'))::int AS closed_this_year
      FROM carecore_quality_events e
      CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
      WHERE e.organization_id = ${ctx.actor.organizationId} AND (${manager} OR e.reported_by = ${ctx.actor.id})` as Promise<
      Row[]
    >,
    ctx.sql`
      SELECT r.id, r.first_name, r.last_name, COALESCE(ro.name, '') AS room
      FROM carecore_residents r
      LEFT JOIN LATERAL (SELECT room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      WHERE r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
      ORDER BY r.last_name, r.first_name` as Promise<Row[]>,
    careUnitsOf(ctx),
    manager ? staffOf(ctx) : Promise.resolve([]),
    ctx.sql`
      SELECT event_type, COUNT(*)::int AS n FROM carecore_event_workflow_steps
      WHERE organization_id = ${ctx.actor.organizationId} GROUP BY event_type` as Promise<Row[]>,
    readEventTypes(ctx),
  ]);
  const s = stats[0];
  const thisYear = Number(s.this_year);
  return {
    events: rows.map(mapEvent),
    stats: {
      thisYear,
      lastYearSamePeriod: Number(s.last_year),
      criticalOpen: Number(s.critical_open),
      investigating: Number(s.investigating),
      newToday: Number(s.new_today),
      closedShare: thisYear ? Math.round((Number(s.closed_this_year) / thisYear) * 100) : null,
    },
    residents: residents.map((row) => ({
      id: String(row.id),
      name: `${row.first_name} ${row.last_name}`,
      detail: String(row.room),
    })),
    careUnits,
    staff,
    canManage: manager,
    workflowSteps: Object.fromEntries(workflowRows.map((row) => [String(row.event_type), Number(row.n)])),
    eventTypes: { builtIn: eventTypes.builtIn, custom: eventTypes.custom },
  };
}

export async function reportEvent(ctx: ApiContext, body: Record<string, unknown>) {
  const type = await assertEventType(ctx, text(body.type, 100), "Bitte die Art des Ereignisses wählen.");
  const severity = body.severity as Severity;
  if (!(severity in SEVERITIES)) throw new ApiError("Bitte den Schweregrad wählen.");
  const description = text(body.description, 4000);
  if (!description) throw new ApiError("Bitte beschreiben, was passiert ist.");
  const occurredAt = typeof body.occurredAt === "string" ? new Date(body.occurredAt) : null;
  if (!occurredAt || Number.isNaN(occurredAt.getTime())) throw new ApiError("Bitte Datum und Uhrzeit angeben.");
  if (occurredAt.getTime() > Date.now() + 5 * 60_000) throw new ApiError("Das Ereignis liegt in der Zukunft.");
  const residentId = body.residentId ? await assertResident(ctx, body.residentId) : null;
  let careUnitId = await assertCareUnit(ctx, body.careUnitId);
  if (!careUnitId && residentId) {
    const stay =
      await ctx.sql`SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = ${residentId} AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1`;
    careUnitId = (stay[0]?.care_unit_id as string | undefined) ?? null;
  }
  const title = text(body.title, 180) || type;
  const immediateAction = text(body.immediateAction, 2000) || null;
  const id = randomUUID();
  // Meldung, Protokoll und Benachrichtigung der Qualitätsverantwortlichen gemeinsam.
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_quality_events (id, organization_id, resident_id, care_unit_id, reported_by, type, severity, status,
        occurred_at, description, title, immediate_action)
      VALUES (${id}, ${ctx.actor.organizationId}, ${residentId}, ${careUnitId}, ${ctx.actor.id}, ${type}, ${severity}, 'open',
        ${occurredAt.toISOString()}, ${description}, ${title}, ${immediateAction})`,
    auditStatement(ctx, "quality_event", id, "reported", null, { type, severity, residentId, careUnitId, title }),
    // Folgeaufgaben aus der Ablaufkette dieser Ereignisart (falls die Einrichtung eine festgelegt hat).
    workflowTaskStatement(ctx, { id, type, title, residentId, careUnitId, occurredAt: occurredAt.toISOString() }),
    ...notifyStatements(
      ctx,
      await qualityManagers(ctx),
      `${severity === "critical" ? "Kritisches Ereignis" : "Neues Ereignis"}: ${title}`,
      description.slice(0, 180),
      "quality_event",
      "/c/leitung/qualitaet",
      severity === "critical" ? "high" : "normal",
    ),
  ]);
  return id;
}

async function loadEvent(ctx: ApiContext, idInput: unknown) {
  const id = assertUuid(idInput, "Ereignis");
  const rows = (await ctx.sql`
    SELECT * FROM carecore_quality_events WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Ereignis nicht gefunden.", 404);
  return rows[0];
}

// Status workflow open → investigating → resolved → closed; resolving needs a resolution.
export async function updateEvent(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  requireManage(ctx);
  const before = await loadEvent(ctx, idInput);
  const status = (body.status ?? before.status) as EventStatus;
  if (!(status in EVENT_STATUS)) throw new ApiError("Ungültiger Status.");
  const ownerId = "ownerId" in body ? await assertStaff(ctx, body.ownerId) : ((before.owner_user_id as string) ?? null);
  const severity = (body.severity ?? before.severity) as Severity;
  if (!(severity in SEVERITIES)) throw new ApiError("Ungültiger Schweregrad.");
  const resolution = "resolution" in body ? text(body.resolution, 4000) || null : (before.resolution as string | null);
  const done = status === "resolved" || status === "closed";
  if (done && !resolution) throw new ApiError("Bitte Ergebnis und umgesetzte Massnahmen beschreiben.");
  if (before.status === "closed" && status === "closed")
    throw new ApiError("Abgeschlossene Ereignisse können nicht mehr geändert werden.", 409);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_quality_events SET status = ${status}, severity = ${severity}, owner_user_id = ${ownerId},
        resolution = ${resolution},
        resolved_at = CASE WHEN ${done} THEN COALESCE(resolved_at, NOW()) END,
        resolved_by = CASE WHEN ${done} THEN COALESCE(resolved_by, ${ctx.actor.id}::uuid) END,
        updated_at = NOW()
      WHERE id = ${before.id}`,
    auditStatement(
      ctx,
      "quality_event",
      String(before.id),
      status === before.status ? "updated" : `status_${status}`,
      { status: before.status, severity: before.severity, ownerId: before.owner_user_id },
      { status, severity, ownerId, resolution },
    ),
    ...notifyStatements(
      ctx,
      ownerId && ownerId !== before.owner_user_id ? [ownerId] : [],
      `Ereignis zugewiesen: ${before.title ?? before.type}`,
      "Bitte das Ereignis prüfen und Massnahmen festlegen.",
      "quality_event",
      "/c/leitung/qualitaet",
    ),
  ]);
}

// ----------------------------------------------------------------- actions

function mapAction(row: Row): QualityAction {
  return {
    id: String(row.id),
    title: String(row.title),
    description: (row.description as string | null) ?? null,
    eventId: (row.quality_event_id as string | null) ?? null,
    eventTitle: (row.event_title as string | null) ?? null,
    careUnit: (row.care_unit as string | null) ?? null,
    ownerId: (row.owner_user_id as string | null) ?? null,
    ownerName: (row.owner_name as string | null) ?? null,
    dueOn: (row.due_day as string | null) ?? null,
    overdue: Boolean(row.overdue),
    status: row.status as ActionStatus,
    effectiveness: (row.effectiveness as Effectiveness | null) ?? null,
    completionNote: (row.completion_note as string | null) ?? null,
    completedAt: iso(row.completed_at),
    createdAt: iso(row.created_at) ?? "",
  };
}

export async function actionsData(ctx: ApiContext): Promise<QualityActionsPayload> {
  const [rows, events, careUnits, staff] = await Promise.all([
    ctx.sql`
      SELECT a.*, to_char(a.due_on, 'YYYY-MM-DD') AS due_day, COALESCE(e.title, e.type) AS event_title,
        cu.name AS care_unit, u.display_name AS owner_name,
        (a.status IN ('open', 'planned') AND a.due_on < (NOW() AT TIME ZONE org.tz)::date) AS overdue
      FROM carecore_quality_actions a
      CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
      LEFT JOIN carecore_quality_events e ON e.id = a.quality_event_id
      LEFT JOIN carecore_care_units cu ON cu.id = a.care_unit_id
      LEFT JOIN carecore_users u ON u.id = a.owner_user_id
      WHERE a.organization_id = ${ctx.actor.organizationId}
        AND (a.status IN ('open', 'planned') OR a.updated_at > NOW() - INTERVAL '1 year')
      ORDER BY CASE a.status WHEN 'open' THEN 0 WHEN 'planned' THEN 1 WHEN 'done' THEN 2 ELSE 3 END,
        a.due_on NULLS LAST, a.created_at DESC` as Promise<Row[]>,
    ctx.sql`
      SELECT id, COALESCE(title, type) AS title, occurred_at FROM carecore_quality_events
      WHERE organization_id = ${ctx.actor.organizationId} AND (status IN ('open', 'investigating') OR occurred_at > NOW() - INTERVAL '90 days')
      ORDER BY occurred_at DESC LIMIT 100` as Promise<Row[]>,
    careUnitsOf(ctx),
    staffOf(ctx),
  ]);
  const actions = rows.map(mapAction);
  const active = actions.filter((a) => a.status === "open" || a.status === "planned");
  const year = new Date().getFullYear().toString();
  const done = actions.filter((a) => a.status === "done");
  const rated = done.filter((a) => a.effectiveness);
  return {
    actions,
    stats: {
      active: active.length,
      overdue: active.filter((a) => a.overdue).length,
      owners: new Set(active.map((a) => a.ownerId).filter(Boolean)).size,
      doneThisYear: done.filter((a) => a.completedAt?.startsWith(year)).length,
      effectiveShare: rated.length
        ? Math.round((rated.filter((a) => a.effectiveness === "effective").length / rated.length) * 100)
        : null,
    },
    events: events.map((row) => ({ id: String(row.id), name: String(row.title), detail: iso(row.occurred_at) ?? "" })),
    careUnits,
    staff,
    canManage: canManageQuality(ctx),
  };
}

async function parseAction(ctx: ApiContext, body: Record<string, unknown>) {
  const title = text(body.title, 180);
  if (!title) throw new ApiError("Bitte einen Titel für die Massnahme angeben.");
  const dueOn = typeof body.dueOn === "string" && DATE.test(body.dueOn) ? body.dueOn : null;
  if (!dueOn) throw new ApiError("Bitte einen Termin festlegen.");
  let eventId: string | null = null;
  if (body.eventId) eventId = String((await loadEvent(ctx, body.eventId)).id);
  return {
    title,
    description: text(body.description, 4000) || null,
    dueOn,
    eventId,
    ownerId: await assertStaff(ctx, body.ownerId),
    careUnitId: await assertCareUnit(ctx, body.careUnitId),
  };
}

export async function createAction(ctx: ApiContext, body: Record<string, unknown>) {
  requireManage(ctx);
  const action = await parseAction(ctx, body);
  const status = body.status === "planned" ? "planned" : "open";
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_quality_actions (id, organization_id, quality_event_id, care_unit_id, title, description,
        owner_user_id, due_on, status, created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${action.eventId}, ${action.careUnitId}, ${action.title}, ${action.description},
        ${action.ownerId}, ${action.dueOn}, ${status}, ${ctx.actor.id})`,
    ...(action.eventId
      ? [
          ctx.sql`UPDATE carecore_quality_events SET status = 'investigating', updated_at = NOW() WHERE id = ${action.eventId} AND status = 'open'`,
        ]
      : []),
    auditStatement(ctx, "quality_action", id, "created", null, { ...action, status }),
    ...notifyStatements(
      ctx,
      [action.ownerId],
      `Qualitätsmassnahme: ${action.title}`,
      `Termin ${action.dueOn.split("-").reverse().join(".")}`,
      "quality_action",
      "/c/leitung/qualitaet/massnahmen",
    ),
  ]);
  return id;
}

async function loadAction(ctx: ApiContext, idInput: unknown) {
  const id = assertUuid(idInput, "Massnahme");
  const rows = (await ctx.sql`
    SELECT * FROM carecore_quality_actions WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`) as Row[];
  if (!rows[0]) throw new ApiError("Massnahme nicht gefunden.", 404);
  return rows[0];
}

// Either a status change (done needs an effectiveness rating, cancelling a reason) or an edit of an open
// action. The edit form also sends its status (open/planned), so an edit is recognised by its title.
export async function updateAction(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  requireManage(ctx);
  const before = await loadAction(ctx, idInput);
  if (before.status === "done" || before.status === "cancelled")
    throw new ApiError("Abgeschlossene Massnahmen können nicht mehr geändert werden.", 409);
  if (!("title" in body)) {
    const status = body.status as ActionStatus;
    if (!(status in ACTION_STATUS)) throw new ApiError("Ungültiger Status.");
    if (status === before.status) return;
    const note = text(body.note, 2000) || null;
    const effectiveness = status === "done" ? (body.effectiveness as Effectiveness) : null;
    if (status === "done" && !(effectiveness && effectiveness in EFFECTIVENESS))
      throw new ApiError("Bitte die Wirksamkeit bewerten.");
    if (status === "done" && !note) throw new ApiError("Bitte den Nachweis bzw. das Ergebnis beschreiben.");
    if (status === "cancelled" && !note) throw new ApiError("Bitte den Grund angeben.");
    const closing = status === "done" || status === "cancelled";
    await ctx.sql.transaction([
      ctx.sql`
        UPDATE carecore_quality_actions SET status = ${status}, effectiveness = ${effectiveness},
          completion_note = ${closing ? note : null},
          completed_at = CASE WHEN ${status === "done"} THEN NOW() END,
          completed_by = CASE WHEN ${status === "done"} THEN ${ctx.actor.id}::uuid END,
          updated_at = NOW()
        WHERE id = ${before.id}`,
      auditStatement(
        ctx,
        "quality_action",
        String(before.id),
        `status_${status}`,
        { status: before.status },
        { status, effectiveness, note },
      ),
    ]);
    return;
  }
  const action = await parseAction(ctx, body);
  const status = body.status === "planned" || body.status === "open" ? body.status : String(before.status);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_quality_actions SET title = ${action.title}, description = ${action.description},
        quality_event_id = ${action.eventId}, care_unit_id = ${action.careUnitId}, owner_user_id = ${action.ownerId},
        due_on = ${action.dueOn}, status = ${status}, updated_at = NOW()
      WHERE id = ${before.id}`,
    auditStatement(
      ctx,
      "quality_action",
      String(before.id),
      "updated",
      {
        title: before.title,
        description: before.description,
        eventId: before.quality_event_id,
        careUnitId: before.care_unit_id,
        ownerId: before.owner_user_id,
        dueOn: before.due_on,
        status: before.status,
      },
      { ...action, status },
    ),
    ...notifyStatements(
      ctx,
      action.ownerId && action.ownerId !== before.owner_user_id ? [action.ownerId] : [],
      `Qualitätsmassnahme: ${action.title}`,
      `Termin ${action.dueOn.split("-").reverse().join(".")}`,
      "quality_action",
      "/c/leitung/qualitaet/massnahmen",
    ),
  ]);
}
