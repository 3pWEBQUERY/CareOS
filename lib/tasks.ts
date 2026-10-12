import { randomUUID } from "node:crypto";
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
import { capturedAt } from "@/lib/request-receipts";
import { listCareUnits } from "@/lib/medication";
import { hasPermission } from "@/lib/server-data";
import {
  TASK_CATEGORIES,
  TASK_DOC_CATEGORY,
  TASK_PRIORITIES,
  TASK_OUTCOMES,
  TASK_RECURRENCE,
  isActiveTask,
  type Task,
  type TaskPerson,
  type TaskPriority,
  type TaskRecurrence,
  type TasksPayload,
} from "@/lib/tasks-shared";

const DAY = 86_400_000;
const canManage = (ctx: ApiContext) =>
  hasPermission(ctx.actor, "team.manage") || hasPermission(ctx.actor, "schedule.manage");

function mapTask(row: Row, ctx: ApiContext, manager: boolean): Task {
  return {
    id: String(row.id),
    title: String(row.title),
    description: (row.description as string | null) ?? "",
    category: String(row.category),
    priority: (row.priority as TaskPriority) in TASK_PRIORITIES ? (row.priority as TaskPriority) : "normal",
    status: row.status as Task["status"],
    dueAt: iso(row.due_at),
    overdue: Boolean(row.overdue),
    residentId: (row.resident_id as string | null) ?? null,
    residentName: (row.resident_name as string | null) ?? null,
    room: (row.room as string | null) ?? null,
    careUnitId: (row.care_unit_id as string | null) ?? null,
    careUnit: (row.care_unit as string | null) ?? null,
    assignedTo: (row.assigned_to as string | null) ?? null,
    assigneeName: (row.assignee_name as string | null) ?? null,
    createdBy: (row.created_by as string | null) ?? null,
    creatorName: (row.creator_name as string | null) ?? null,
    createdAt: iso(row.created_at) ?? "",
    completedAt: iso(row.completed_at),
    completedByName: (row.completed_by_name as string | null) ?? null,
    completionNote: (row.completion_note as string | null) ?? null,
    cancelReason: (row.cancel_reason as string | null) ?? null,
    escalatedAt: iso(row.escalated_at),
    escalatedByName: (row.escalated_by_name as string | null) ?? null,
    escalationReason: (row.escalation_reason as string | null) ?? null,
    teamVisible: Boolean(row.team_visible),
    remind: Boolean(row.remind),
    documentOnCompletion: Boolean(row.document_on_completion),
    recurrence: (row.recurrence as TaskRecurrence) in TASK_RECURRENCE ? (row.recurrence as TaskRecurrence) : "none",
    canEdit: manager || row.created_by === ctx.actor.id || row.assigned_to === ctx.actor.id,
  };
}

async function selectTasks(ctx: ApiContext, where: { taskId?: string; scope?: "mine" | "team"; residentId?: string }) {
  const { sql, actor } = ctx;
  return (await sql`
    SELECT t.*, (t.status IN ('open', 'in_progress', 'escalated') AND t.due_at < NOW()) AS overdue,
      r.first_name || ' ' || r.last_name AS resident_name, ro.name AS room, cu.name AS care_unit,
      ua.display_name AS assignee_name, uc.display_name AS creator_name, ud.display_name AS completed_by_name,
      ue.display_name AS escalated_by_name
    FROM carecore_tasks t
    LEFT JOIN carecore_residents r ON r.id = t.resident_id
    LEFT JOIN LATERAL (SELECT room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
    LEFT JOIN carecore_care_units cu ON cu.id = t.care_unit_id
    LEFT JOIN carecore_users ua ON ua.id = t.assigned_to
    LEFT JOIN carecore_users uc ON uc.id = t.created_by
    LEFT JOIN carecore_users ud ON ud.id = t.completed_by
    LEFT JOIN carecore_users ue ON ue.id = t.escalated_by
    WHERE t.organization_id = ${actor.organizationId}
      AND (${where.taskId ?? null}::uuid IS NULL OR t.id = ${where.taskId ?? null}::uuid)
      AND (${where.residentId ?? null}::uuid IS NULL OR t.resident_id = ${where.residentId ?? null}::uuid)
      AND (${where.taskId ?? null}::uuid IS NOT NULL OR t.status IN ('open', 'in_progress', 'escalated') OR t.updated_at > NOW() - INTERVAL '7 days')
      AND CASE ${where.scope ?? "all"}
        WHEN 'mine' THEN t.assigned_to = ${actor.id}
        ELSE t.team_visible OR t.assigned_to = ${actor.id} OR t.created_by = ${actor.id}
      END
    ORDER BY t.status NOT IN ('open', 'in_progress', 'escalated'), t.status <> 'escalated', t.due_at NULLS LAST, t.created_at DESC
    LIMIT 500`) as Row[];
}

export async function listPeople({ sql, actor }: ApiContext): Promise<TaskPerson[]> {
  const rows = (await sql`
    SELECT u.id, u.display_name, COALESCE(p.job_title, '') AS job_title FROM carecore_users u
    JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE p.organization_id = ${actor.organizationId} AND u.active = TRUE ORDER BY u.display_name`) as Row[];
  return rows.map((row) => ({ id: String(row.id), name: String(row.display_name), role: String(row.job_title) }));
}

export async function listTasks(ctx: ApiContext, params: URLSearchParams): Promise<TasksPayload> {
  const scope = params.get("scope") === "mine" ? "mine" : "team";
  const residentId = params.get("residentId") ? assertUuid(params.get("residentId"), "Auswahl") : undefined;
  const manager = canManage(ctx);
  const [rows, people, careUnits] = await Promise.all([
    selectTasks(ctx, { scope, residentId }),
    listPeople(ctx),
    listCareUnits(ctx),
  ]);
  return {
    tasks: rows.map((row) => mapTask(row, ctx, manager)),
    people,
    careUnits,
    currentUserId: ctx.actor.id,
    canWrite: hasPermission(ctx.actor, "documentation.write"),
    canManage: manager,
  };
}

async function loadTask(ctx: ApiContext, taskIdInput: unknown) {
  const taskId = assertUuid(taskIdInput, "Aufgabe");
  const row = (await selectTasks(ctx, { taskId }))[0];
  if (!row) throw new ApiError("Aufgabe nicht gefunden.", 404);
  return mapTask(row, ctx, canManage(ctx));
}

type TaskInput = {
  title: string;
  description: string;
  category: string;
  priority: TaskPriority;
  residentId: string | null;
  careUnitId: string | null;
  assignedTo: string | null;
  dueAt: string | null;
  recurrence: TaskRecurrence;
  teamVisible: boolean;
  remind: boolean;
  documentOnCompletion: boolean;
};

async function parseTask(ctx: ApiContext, body: Record<string, unknown>): Promise<TaskInput> {
  const { sql, actor } = ctx;
  const title = text(body.title, 240);
  if (title.length < 3) throw new ApiError("Bitte einen Aufgabentitel mit mindestens 3 Zeichen angeben.");
  const category =
    typeof body.category === "string" && (TASK_CATEGORIES as readonly string[]).includes(body.category)
      ? body.category
      : "Pflege";
  const priority =
    typeof body.priority === "string" && body.priority in TASK_PRIORITIES ? (body.priority as TaskPriority) : "normal";
  const recurrence =
    typeof body.recurrence === "string" && body.recurrence in TASK_RECURRENCE
      ? (body.recurrence as TaskRecurrence)
      : "none";
  let dueAt: string | null = null;
  if (body.dueAt !== undefined && body.dueAt !== null && body.dueAt !== "") {
    if (typeof body.dueAt !== "string" || Number.isNaN(Date.parse(body.dueAt)))
      throw new ApiError("Der Fälligkeitszeitpunkt ist ungültig.");
    dueAt = new Date(body.dueAt).toISOString();
  }
  if (recurrence !== "none" && !dueAt) throw new ApiError("Wiederkehrende Aufgaben brauchen einen Fälligkeitstermin.");

  const residentId = body.residentId ? await assertResident(ctx, body.residentId) : null;
  let careUnitId: string | null = null;
  if (residentId) {
    const stay = (await sql`
      SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = ${residentId} AND ended_at IS NULL
      ORDER BY started_at DESC LIMIT 1`) as Row[];
    careUnitId = (stay[0]?.care_unit_id as string | null) ?? null;
  } else if (body.careUnitId) {
    const unitId = assertUuid(body.careUnitId, "Wohnbereich");
    const unit = (await sql`
      SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
      WHERE cu.id = ${unitId} AND si.organization_id = ${actor.organizationId} LIMIT 1`) as Row[];
    if (!unit[0]) throw new ApiError("Wohnbereich nicht gefunden.", 404);
    careUnitId = unitId;
  }

  let assignedTo: string | null = actor.id;
  if (body.assignedTo === null || body.assignedTo === "") assignedTo = null;
  else if (body.assignedTo !== undefined) {
    const userId = assertUuid(body.assignedTo, "Verantwortliche Person");
    const person = (await sql`
      SELECT u.id FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
      WHERE u.id = ${userId} AND p.organization_id = ${actor.organizationId} AND u.active = TRUE LIMIT 1`) as Row[];
    if (!person[0]) throw new ApiError("Die verantwortliche Person ist nicht verfügbar.", 404);
    assignedTo = userId;
  }
  const teamVisible = body.teamVisible !== false;
  if (!teamVisible && assignedTo !== actor.id)
    throw new ApiError("Private Aufgaben können nur dir selbst zugewiesen werden.");

  return {
    title,
    description: text(body.description, 5000),
    category,
    priority,
    residentId,
    careUnitId,
    assignedTo,
    dueAt,
    recurrence,
    teamVisible,
    remind: body.remind !== false,
    documentOnCompletion: body.documentOnCompletion === true && Boolean(residentId),
  };
}

async function notifyAssignee(ctx: ApiContext, taskId: string, input: TaskInput, previousAssignee: string | null) {
  if (!input.assignedTo || input.assignedTo === ctx.actor.id || input.assignedTo === previousAssignee) return;
  await ctx.sql`
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url)
    VALUES (${randomUUID()}, ${input.assignedTo}, ${`Neue Aufgabe: ${input.title}`},
      ${`${ctx.actor.display_name} hat dir eine Aufgabe zugewiesen.`}, 'task_assigned',
      ${input.priority === "critical" || input.priority === "high" ? "high" : "normal"}, ${`/c/betrieb/aufgaben?task=${taskId}`})`;
}

export async function createTask(ctx: ApiContext, body: Record<string, unknown>) {
  const input = await parseTask(ctx, body);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
    INSERT INTO carecore_tasks (id, organization_id, resident_id, care_unit_id, assigned_to, created_by, title, description,
      category, priority, due_at, recurrence, team_visible, remind, document_on_completion)
    VALUES (${id}, ${ctx.actor.organizationId}, ${input.residentId}, ${input.careUnitId}, ${input.assignedTo}, ${ctx.actor.id},
      ${input.title}, ${input.description || null}, ${input.category}, ${input.priority}, ${input.dueAt}, ${input.recurrence},
      ${input.teamVisible}, ${input.remind}, ${input.documentOnCompletion})`,
    auditStatement(ctx, "task", id, "created", null, input),
  ]);
  await notifyAssignee(ctx, id, input, null);
  return id;
}

export async function updateTask(ctx: ApiContext, taskIdInput: unknown, body: Record<string, unknown>) {
  const before = await loadTask(ctx, taskIdInput);
  if (!before.canEdit)
    throw new ApiError("Nur Ersteller, Verantwortliche oder die Leitung dürfen die Aufgabe ändern.", 403);
  if (!isActiveTask(before.status))
    throw new ApiError("Abgeschlossene oder abgebrochene Aufgaben können nicht mehr geändert werden.", 409);
  const input = await parseTask(ctx, { assignedTo: before.assignedTo, ...body });
  await ctx.sql.transaction([
    ctx.sql`
    UPDATE carecore_tasks SET title = ${input.title}, description = ${input.description || null}, category = ${input.category},
      priority = ${input.priority}, resident_id = ${input.residentId}, care_unit_id = ${input.careUnitId},
      assigned_to = ${input.assignedTo}, due_at = ${input.dueAt}, recurrence = ${input.recurrence},
      team_visible = ${input.teamVisible}, remind = ${input.remind}, document_on_completion = ${input.documentOnCompletion},
      reminded_at = CASE WHEN due_at IS DISTINCT FROM ${input.dueAt}::timestamptz THEN NULL ELSE reminded_at END,
      updated_at = NOW()
    WHERE id = ${before.id} AND organization_id = ${ctx.actor.organizationId}`,
    auditStatement(ctx, "task", before.id, "updated", before, input),
  ]);
  await notifyAssignee(ctx, before.id, input, before.assignedTo);
}

// Next due date of a recurring task: one interval after the last due date, but not in the past.
function nextDue(dueAt: string, recurrence: TaskRecurrence) {
  const step = recurrence === "weekly" ? 7 * DAY : DAY;
  let next = Date.parse(dueAt) + step;
  while (next < Date.now()) next += step;
  return new Date(next).toISOString();
}

export async function setTaskStatus(ctx: ApiContext, taskIdInput: unknown, body: Record<string, unknown>) {
  const task = await loadTask(ctx, taskIdInput);
  const { sql, actor } = ctx;
  const status = String(body.status);
  if (!["open", "in_progress", "escalated", "cancelled"].includes(status) && !(status in TASK_OUTCOMES))
    throw new ApiError("Unbekannter Status.");
  if (status === task.status) return;
  if (task.status === "cancelled")
    throw new ApiError("Abgebrochene Aufgaben können nicht wieder aufgenommen werden.", 409);
  const active = isActiveTask(task.status);

  if (status === "cancelled") {
    if (!task.canEdit) throw new ApiError("Nur Ersteller, Verantwortliche oder die Leitung dürfen abbrechen.", 403);
    if (!active) throw new ApiError("Abgeschlossene Aufgaben können nicht abgebrochen werden.", 409);
    const reason = text(body.reason, 1000);
    if (!reason) throw new ApiError("Bitte den Grund für den Abbruch angeben.");
    await sql.transaction([
      sql`UPDATE carecore_tasks SET status = 'cancelled', cancel_reason = ${reason}, updated_at = NOW() WHERE id = ${task.id}`,
      auditStatement(ctx, "task", task.id, "cancelled", { status: task.status }, { status, reason }),
    ]);
    return;
  }

  // Eskalieren: die Aufgabe bleibt offen, die Leitung (Recht „team.manage“) wird benachrichtigt.
  if (status === "escalated") {
    if (!active) throw new ApiError("Nur offene Aufgaben können eskaliert werden.", 409);
    const reason = text(body.reason, 1000);
    if (!reason) throw new ApiError("Bitte den Grund für die Eskalation angeben.");
    const title = `Aufgabe eskaliert: ${task.title}`;
    const detail = `${actor.display_name}${task.residentName ? ` · ${task.residentName}` : ""}: ${reason}`;
    await sql.transaction([
      sql`UPDATE carecore_tasks SET status = 'escalated', escalated_at = NOW(), escalated_by = ${actor.id},
        escalation_reason = ${reason}, updated_at = NOW() WHERE id = ${task.id}`,
      sql`
        INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url, entity_type, entity_id)
        SELECT gen_random_uuid(), u.id, ${title}, ${detail}, 'task_escalated', 'high',
          ${`/c/betrieb/aufgaben/team?task=${task.id}`}, 'task', ${task.id}::uuid
        FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
        WHERE p.organization_id = ${actor.organizationId} AND u.active AND u.id <> ${actor.id}
          AND COALESCE(carecore_effective_permissions(u.id), '[]'::jsonb) ? 'team.manage'`,
      auditStatement(ctx, "task", task.id, "escalated", { status: task.status }, { status, reason }),
    ]);
    return;
  }

  if (status in TASK_OUTCOMES) {
    if (!active) throw new ApiError("Die Aufgabe ist bereits abgeschlossen.", 409);
    const outcome = status as keyof typeof TASK_OUTCOMES;
    const note = text(body.note, 10000);
    // Offline erledigt: der Zeitpunkt der Erledigung, nicht der Übertragung.
    const completedAt = capturedAt(body.completedAt);
    if (outcome !== "completed" && note.length < 3)
      throw new ApiError(
        outcome === "partial"
          ? "Bitte kurz beschreiben, was erledigt wurde und was offen bleibt."
          : "Bitte den Grund angeben, warum die Aufgabe nicht erledigt wurde.",
      );
    if (outcome === "completed" && task.documentOnCompletion && note.length < 3)
      throw new ApiError("Diese Aufgabe verlangt eine Dokumentation. Bitte kurz beschreiben, was durchgeführt wurde.");
    const statements = [
      sql`UPDATE carecore_tasks SET status = ${outcome}, completed_at = COALESCE(${completedAt}::timestamptz, NOW()), completed_by = ${actor.id},
        completion_note = ${note || null}, updated_at = NOW() WHERE id = ${task.id}`,
    ];
    // Abweichungen (teilweise / nicht erledigt) gehören immer in die Pflegedokumentation, Erledigtes auf Wunsch.
    if (note && task.residentId && (outcome !== "completed" || task.documentOnCompletion)) {
      const prefix =
        outcome === "completed" ? task.title : `${task.title} (${TASK_OUTCOMES[outcome].label.toLowerCase()})`;
      statements.push(sql`
        INSERT INTO carecore_documentation_entries (id, resident_id, care_unit_id, author_user_id, category, title, body, occurred_at, importance)
        SELECT ${randomUUID()}, ${task.residentId},
          (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = ${task.residentId} AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1),
          ${actor.id}, ${TASK_DOC_CATEGORY[task.category] ?? "Pflege"}, ${task.title}, ${`${prefix}: ${note}`},
          COALESCE(${completedAt}::timestamptz, NOW()), ${outcome === "completed" ? "standard" : "important"}`);
    }
    let followUpId: string | null = null;
    if (task.recurrence !== "none" && task.dueAt) {
      followUpId = randomUUID();
      statements.push(sql`
        INSERT INTO carecore_tasks (id, organization_id, resident_id, care_unit_id, assigned_to, created_by, title, description,
          category, priority, due_at, recurrence, team_visible, remind, document_on_completion)
        SELECT ${followUpId}, organization_id, resident_id, care_unit_id, assigned_to, created_by, title, description,
          category, priority, ${nextDue(task.dueAt, task.recurrence)}, recurrence, team_visible, remind, document_on_completion
        FROM carecore_tasks WHERE id = ${task.id}`);
      statements.push(sql`UPDATE carecore_tasks SET follow_up_task_id = ${followUpId} WHERE id = ${task.id}`);
    }
    statements.push(
      auditStatement(ctx, "task", task.id, outcome, { status: task.status }, { status: outcome, note, followUpId }),
    );
    await sql.transaction(statements);
    return;
  }

  // Reopen or start: an untouched follow-up of a recurring task is withdrawn again.
  await sql.transaction([
    sql`UPDATE carecore_tasks SET status = 'cancelled', cancel_reason = 'Vorgänger wieder geöffnet', updated_at = NOW()
      WHERE id = (SELECT follow_up_task_id FROM carecore_tasks WHERE id = ${task.id}) AND status = 'open'`,
    sql`UPDATE carecore_tasks SET status = ${status}, completed_at = NULL, completed_by = NULL, completion_note = NULL,
      follow_up_task_id = NULL, updated_at = NOW() WHERE id = ${task.id}`,
    auditStatement(
      ctx,
      "task",
      task.id,
      status === "open" ? "reopened" : "started",
      { status: task.status },
      { status },
    ),
  ]);
}

// Creates due-date reminders for the signed-in person (called when notifications are loaded).
export async function createDueReminders(ctx: ApiContext) {
  await ctx.sql`
    WITH due AS (
      UPDATE carecore_tasks SET reminded_at = NOW()
      WHERE organization_id = ${ctx.actor.organizationId} AND assigned_to = ${ctx.actor.id} AND remind
        AND reminded_at IS NULL AND status IN ('open', 'in_progress', 'escalated') AND due_at <= NOW() + INTERVAL '15 minutes'
        AND due_at > NOW() - INTERVAL '24 hours'
      RETURNING id, title, priority, due_at
    )
    INSERT INTO carecore_notifications (id, user_id, title, body, type, priority, link_url)
    SELECT gen_random_uuid(), ${ctx.actor.id}, 'Aufgabe fällig: ' || title,
      'Fällig um ' || to_char(due_at AT TIME ZONE (SELECT timezone FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}), 'HH24:MI') || ' Uhr.',
      'task_due', CASE WHEN priority IN ('high', 'critical') THEN 'high' ELSE 'normal' END, '/c/betrieb/aufgaben?task=' || id
    FROM due`;
}
