import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, auditStatement, text, type ApiContext, type Row } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { DAY_PART_KEYS, type DayPart } from "@/lib/intervention-proofs-shared";
import {
  GOAL_CATEGORIES,
  type CareTemplates,
  type GoalTemplate,
  type InterventionTemplate,
  type TemplateIntervention,
} from "@/lib/care-planning-shared";

// Vorlagen für die Pflegeplanung: lesen dürfen alle, die planen; pflegen dürfen Personen mit dem Recht „Qualität“
// (wie die Pflegestandards). Nicht mehr verwendete Vorlagen werden ausgeblendet, nicht gelöscht.

function assertManage(ctx: ApiContext) {
  if (!hasPermission(ctx.actor, "quality.manage")) throw new ApiError("Keine Berechtigung.", 403);
}

const category = (value: unknown) => {
  if (typeof value !== "string" || !(GOAL_CATEGORIES as readonly string[]).includes(value))
    throw new ApiError("Bitte den Pflegebereich wählen.");
  return value;
};

const dayParts = (value: unknown): DayPart[] =>
  DAY_PART_KEYS.filter((part) => Array.isArray(value) && value.includes(part));

export function parseTemplateIntervention(input: unknown): TemplateIntervention {
  const value = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const result = {
    title: text(value.title, 220),
    instructions: text(value.instructions, 4000),
    frequency: text(value.frequency, 100),
    responsibleRole: text(value.responsibleRole, 100),
    dayParts: dayParts(value.dayParts),
  };
  if (!result.title) throw new ApiError("Bitte jede Massnahme benennen.");
  if (!result.frequency) throw new ApiError(`Bitte bei „${result.title}“ die Häufigkeit angeben.`);
  return result;
}

function parseGoalTemplate(body: Record<string, unknown>) {
  const result = {
    category: category(body.category),
    title: text(body.title, 160),
    problem: text(body.problem, 4000),
    resources: text(body.resources, 4000),
    statement: text(body.statement, 2000),
    reviewDays:
      body.reviewDays === null || body.reviewDays === "" || body.reviewDays === undefined
        ? null
        : Number(body.reviewDays),
    interventions: (Array.isArray(body.interventions) ? body.interventions : [])
      .slice(0, 30)
      .map(parseTemplateIntervention),
  };
  if (!result.title) throw new ApiError("Bitte der Vorlage einen Namen geben.");
  if (!result.problem) throw new ApiError("Bitte das Pflegeproblem beschreiben.");
  if (!result.statement) throw new ApiError("Bitte das Ziel formulieren.");
  if (
    result.reviewDays !== null &&
    (!Number.isInteger(result.reviewDays) || result.reviewDays < 1 || result.reviewDays > 365)
  )
    throw new ApiError("Die Überprüfung muss nach 1 bis 365 Tagen sein.");
  return result;
}

function parseInterventionTemplate(body: Record<string, unknown>) {
  return { category: category(body.category), ...parseTemplateIntervention(body) };
}

export async function careTemplates(ctx: ApiContext): Promise<CareTemplates> {
  const [goals, interventions] = (await Promise.all([
    ctx.sql`
      SELECT * FROM carecore_care_goal_templates WHERE organization_id = ${ctx.actor.organizationId}
        AND archived_at IS NULL ORDER BY category, title`,
    ctx.sql`
      SELECT * FROM carecore_intervention_templates WHERE organization_id = ${ctx.actor.organizationId}
        AND archived_at IS NULL ORDER BY category, title`,
  ])) as Row[][];
  return {
    goals: goals.map((row): GoalTemplate => ({
      id: String(row.id),
      category: String(row.category),
      title: String(row.title),
      problem: String(row.problem),
      resources: String(row.resources),
      statement: String(row.statement),
      reviewDays: row.review_days === null ? null : Number(row.review_days),
      interventions: (Array.isArray(row.interventions) ? row.interventions : []) as TemplateIntervention[],
    })),
    interventions: interventions.map((row): InterventionTemplate => ({
      id: String(row.id),
      category: String(row.category),
      title: String(row.title),
      instructions: String(row.instructions),
      frequency: String(row.frequency),
      responsibleRole: String(row.responsible_role ?? ""),
      dayParts: dayParts(row.day_parts),
    })),
    canManage: hasPermission(ctx.actor, "quality.manage"),
  };
}

// { kind: "goal" | "intervention", ...Felder } – neue Vorlage.
export async function createTemplate(ctx: ApiContext, body: Record<string, unknown>) {
  assertManage(ctx);
  const id = randomUUID();
  if (body.kind === "intervention") {
    const value = parseInterventionTemplate(body);
    await ctx.sql.transaction([
      ctx.sql`
        INSERT INTO carecore_intervention_templates (id, organization_id, category, title, instructions, frequency,
          responsible_role, day_parts, created_by)
        VALUES (${id}, ${ctx.actor.organizationId}, ${value.category}, ${value.title}, ${value.instructions},
          ${value.frequency}, ${value.responsibleRole || null}, ${value.dayParts}::text[], ${ctx.actor.id})`,
      auditStatement(ctx, "intervention_template", id, "created", null, value),
    ]);
    return { id };
  }
  const value = parseGoalTemplate(body);
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_care_goal_templates (id, organization_id, category, title, problem, resources, statement,
        review_days, interventions, created_by)
      VALUES (${id}, ${ctx.actor.organizationId}, ${value.category}, ${value.title}, ${value.problem}, ${value.resources},
        ${value.statement}, ${value.reviewDays}, ${JSON.stringify(value.interventions)}::jsonb, ${ctx.actor.id})`,
    auditStatement(ctx, "care_goal_template", id, "created", null, { title: value.title, category: value.category }),
  ]);
  return { id };
}

async function templateRow(ctx: ApiContext, kind: unknown, input: unknown) {
  const id = assertUuid(input, "Vorlage");
  const rows = (await (kind === "intervention"
    ? ctx.sql`SELECT * FROM carecore_intervention_templates WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`
    : ctx.sql`SELECT * FROM carecore_care_goal_templates WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId}`)) as Row[];
  if (!rows[0] || rows[0].archived_at) throw new ApiError("Vorlage nicht gefunden.", 404);
  return rows[0];
}

// Vorlage ändern ({ kind, ...Felder }) oder ausblenden ({ kind, archive: true }).
export async function updateTemplate(ctx: ApiContext, input: unknown, body: Record<string, unknown>) {
  assertManage(ctx);
  const before = await templateRow(ctx, body.kind, input);
  const id = String(before.id);
  if (body.kind === "intervention") {
    if (body.archive === true) {
      await ctx.sql.transaction([
        ctx.sql`UPDATE carecore_intervention_templates SET archived_at = NOW(), updated_at = NOW() WHERE id = ${id}`,
        auditStatement(ctx, "intervention_template", id, "archived", { title: before.title }, null),
      ]);
      return;
    }
    const value = parseInterventionTemplate(body);
    await ctx.sql.transaction([
      ctx.sql`
        UPDATE carecore_intervention_templates SET category = ${value.category}, title = ${value.title},
          instructions = ${value.instructions}, frequency = ${value.frequency},
          responsible_role = ${value.responsibleRole || null}, day_parts = ${value.dayParts}::text[], updated_at = NOW()
        WHERE id = ${id}`,
      auditStatement(ctx, "intervention_template", id, "updated", { title: before.title }, value),
    ]);
    return;
  }
  if (body.archive === true) {
    await ctx.sql.transaction([
      ctx.sql`UPDATE carecore_care_goal_templates SET archived_at = NOW(), updated_at = NOW() WHERE id = ${id}`,
      auditStatement(ctx, "care_goal_template", id, "archived", { title: before.title }, null),
    ]);
    return;
  }
  const value = parseGoalTemplate(body);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_care_goal_templates SET category = ${value.category}, title = ${value.title},
        problem = ${value.problem}, resources = ${value.resources}, statement = ${value.statement},
        review_days = ${value.reviewDays}, interventions = ${JSON.stringify(value.interventions)}::jsonb, updated_at = NOW()
      WHERE id = ${id}`,
    auditStatement(
      ctx,
      "care_goal_template",
      id,
      "updated",
      { title: before.title },
      {
        title: value.title,
        category: value.category,
      },
    ),
  ]);
}
