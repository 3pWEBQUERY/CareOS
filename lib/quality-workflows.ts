import { ApiError, auditStatement, num, text, type ApiContext, type Row } from "@/lib/api-context";
import { assertEventType } from "@/lib/quality-types";
import { TASK_CATEGORIES, TASK_PRIORITIES, type TaskPriority } from "@/lib/tasks-shared";
import { hasPermission } from "@/lib/server-data";

// Ablaufketten: Folgeschritte je Ereignisart, von der Einrichtung festgelegt (keine Vorgaben). Beim Melden eines
// Ereignisses entstehen daraus Aufgaben für das Team, fällig relativ zum Zeitpunkt des Ereignisses.

export const WORKFLOW_MAX_STEPS = 20;
// Späteste Fälligkeit eines Schritts nach dem Ereignis (Minuten) – technische Obergrenze der Eingabe.
export const WORKFLOW_MAX_OFFSET_MINUTES = 43_200;

export type WorkflowStep = {
  title: string;
  description: string | null;
  category: string;
  priority: TaskPriority;
  dueOffsetMinutes: number;
  documentOnCompletion: boolean;
};

export async function listWorkflows(ctx: ApiContext): Promise<Record<string, WorkflowStep[]>> {
  const rows = (await ctx.sql`
    SELECT event_type, title, description, category, priority, due_offset_minutes, document_on_completion
    FROM carecore_event_workflow_steps WHERE organization_id = ${ctx.actor.organizationId}
    ORDER BY event_type, position`) as Row[];
  const workflows: Record<string, WorkflowStep[]> = {};
  for (const row of rows)
    (workflows[String(row.event_type)] ??= []).push({
      title: String(row.title),
      description: (row.description as string | null) ?? null,
      category: String(row.category),
      priority: row.priority as TaskPriority,
      dueOffsetMinutes: Number(row.due_offset_minutes),
      documentOnCompletion: Boolean(row.document_on_completion),
    });
  return workflows;
}

function parseSteps(input: unknown): WorkflowStep[] {
  const raw = Array.isArray(input) ? input : [];
  if (raw.length > WORKFLOW_MAX_STEPS) throw new ApiError(`Höchstens ${WORKFLOW_MAX_STEPS} Schritte je Ablaufkette.`);
  return raw.map((entry, index) => {
    const item = (entry ?? {}) as Record<string, unknown>;
    const label = `Schritt ${index + 1}`;
    const title = text(item.title, 240);
    if (title.length < 3) throw new ApiError(`${label}: Bitte einen Titel mit mindestens 3 Zeichen angeben.`);
    const offset = num(item.dueOffsetMinutes);
    if (offset === null || !Number.isInteger(offset) || offset < 0 || offset > WORKFLOW_MAX_OFFSET_MINUTES)
      throw new ApiError(`${label}: Bitte festlegen, wann der Schritt fällig ist (0 bis 30 Tage nach dem Ereignis).`);
    const category =
      typeof item.category === "string" && (TASK_CATEGORIES as readonly string[]).includes(item.category)
        ? item.category
        : null;
    if (!category) throw new ApiError(`${label}: Bitte die Kategorie wählen.`);
    const priority =
      typeof item.priority === "string" && item.priority in TASK_PRIORITIES ? (item.priority as TaskPriority) : null;
    if (!priority) throw new ApiError(`${label}: Bitte die Priorität wählen.`);
    return {
      title,
      description: text(item.description, 4000) || null,
      category,
      priority,
      dueOffsetMinutes: offset,
      documentOnCompletion: item.documentOnCompletion === true,
    };
  });
}

// Ersetzt die Schritte einer Ereignisart (Qualitätsmanagement). Eine leere Liste entfernt die Ablaufkette.
export async function saveWorkflow(ctx: ApiContext, typeInput: unknown, stepsInput: unknown) {
  if (!hasPermission(ctx.actor, "quality.manage"))
    throw new ApiError("Ablaufketten legt das Qualitätsmanagement fest.", 403);
  const type = await assertEventType(ctx, typeInput, "Bitte die Ereignisart wählen.");
  const steps = parseSteps(stepsInput);
  const before = (await listWorkflows(ctx))[type] ?? [];
  await ctx.sql.transaction([
    ctx.sql`DELETE FROM carecore_event_workflow_steps WHERE organization_id = ${ctx.actor.organizationId} AND event_type = ${type}`,
    ...steps.map(
      (step, position) => ctx.sql`
        INSERT INTO carecore_event_workflow_steps (organization_id, event_type, position, title, description, category, priority,
          due_offset_minutes, document_on_completion)
        VALUES (${ctx.actor.organizationId}, ${type}, ${position}, ${step.title}, ${step.description}, ${step.category},
          ${step.priority}, ${step.dueOffsetMinutes}, ${step.documentOnCompletion})`,
    ),
    auditStatement(
      ctx,
      "event_workflow",
      ctx.actor.organizationId,
      "updated",
      { type, steps: before },
      { type, steps },
    ),
  ]);
  return steps;
}

// Folgeaufgaben eines neuen Ereignisses (Teil der Transaktion beim Melden): eine Anweisung für alle Schritte.
export function workflowTaskStatement(
  ctx: ApiContext,
  event: {
    id: string;
    type: string;
    title: string;
    residentId: string | null;
    careUnitId: string | null;
    occurredAt: string;
  },
) {
  return ctx.sql`
    INSERT INTO carecore_tasks (id, organization_id, resident_id, care_unit_id, assigned_to, created_by, title, description,
      category, priority, due_at, recurrence, team_visible, remind, document_on_completion, quality_event_id)
    SELECT gen_random_uuid(), s.organization_id, ${event.residentId}, ${event.careUnitId}, NULL, ${ctx.actor.id}, s.title,
      CONCAT_WS(E'\n\n', s.description, ${`Folge von Ereignis: ${event.title}`}::text), s.category, s.priority,
      ${event.occurredAt}::timestamptz + make_interval(mins => s.due_offset_minutes), 'none', TRUE, TRUE,
      s.document_on_completion, ${event.id}
    FROM carecore_event_workflow_steps s
    WHERE s.organization_id = ${ctx.actor.organizationId} AND s.event_type = ${event.type}
    ORDER BY s.position`;
}
