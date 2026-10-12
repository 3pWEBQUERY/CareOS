import { randomUUID } from "node:crypto";
import { ApiError, assertUuid, text, type ApiContext, type Row } from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { DAY_PART_KEYS } from "@/lib/intervention-proofs-shared";
import { GOAL_CATEGORIES, type GoalStatus, type InterventionStatus, type Outcome } from "@/lib/care-planning-shared";
import { date, OPEN, loadPlan, assertOpen, today } from "./care-planning";

// ------------------------------------------------------------------ goals

// Protokolleintrag für die Akte des Bewohners, gemeinsam mit der Änderung ausgeführt.
const log = (
  ctx: ApiContext,
  residentId: unknown,
  entityType: string,
  entityId: unknown,
  action: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
) =>
  residentAudit(ctx.sql, ctx.actor, {
    residentId: String(residentId),
    entityType,
    entityId: String(entityId),
    action,
    before,
    after,
  });

export function parseGoal(body: Record<string, unknown>) {
  const goal = {
    category:
      typeof body.category === "string" && (GOAL_CATEGORIES as readonly string[]).includes(body.category)
        ? body.category
        : "",
    problem: text(body.problem, 4000) || null,
    resources: text(body.resources, 4000) || null,
    statement: text(body.statement, 2000),
    targetDate: date(body.targetDate),
  };
  if (!goal.category) throw new ApiError("Bitte den Pflegebereich wählen.");
  if (!goal.problem) throw new ApiError("Bitte das Pflegeproblem beschreiben.");
  if (!goal.statement) throw new ApiError("Bitte das Ziel überprüfbar formulieren.");
  if (!goal.targetDate) throw new ApiError("Bitte ein Überprüfungsdatum für das Ziel angeben.");
  return goal;
}

export async function loadGoal(ctx: ApiContext, goalIdInput: unknown) {
  const id = assertUuid(goalIdInput, "Pflegeziel");
  const rows = (await ctx.sql`
    SELECT g.*, p.status AS plan_status, p.resident_id FROM carecore_care_goals g
    JOIN carecore_care_plans p ON p.id = g.care_plan_id
    JOIN carecore_residents r ON r.id = p.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    WHERE g.id = ${id}`) as Row[];
  if (!rows[0]) throw new ApiError("Pflegeziel nicht gefunden.", 404);
  if (!OPEN.includes(String(rows[0].plan_status))) throw new ApiError("Der Pflegeplan ist abgeschlossen.", 409);
  return rows[0];
}

export async function addGoal(ctx: ApiContext, planId: unknown, body: Record<string, unknown>) {
  const plan = await loadPlan(ctx, planId);
  assertOpen(plan);
  const goal = parseGoal(body);
  if (goal.targetDate && goal.targetDate < (await today(ctx)))
    throw new ApiError("Das Überprüfungsdatum liegt in der Vergangenheit.");
  // Aus einer Vorlage: Herkunft festhalten und die gewählten Massnahmen gleich mit anlegen.
  let templateId: string | null = null;
  if (body.templateId) {
    templateId = assertUuid(body.templateId, "Vorlage");
    const [template] = (await ctx.sql`
      SELECT id FROM carecore_care_goal_templates WHERE id = ${templateId}
        AND organization_id = ${ctx.actor.organizationId}`) as Row[];
    if (!template) throw new ApiError("Vorlage nicht gefunden.", 404);
  }
  const interventions = (Array.isArray(body.interventions) ? body.interventions : [])
    .slice(0, 30)
    .map((item) => parseIntervention((item && typeof item === "object" ? item : {}) as Record<string, unknown>));
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_care_goals (id, care_plan_id, category, problem, resources, statement, target_date, status,
        template_id, created_by)
      VALUES (${id}, ${plan.id}, ${goal.category}, ${goal.problem}, ${goal.resources}, ${goal.statement}, ${goal.targetDate},
        'active', ${templateId}, ${ctx.actor.id})`,
    ctx.sql`UPDATE carecore_care_plans SET updated_at = NOW() WHERE id = ${plan.id}`,
    log(ctx, plan.resident_id, "care_goal", id, "created", null, { planId: plan.id, ...goal, templateId }),
    ...interventions.flatMap((intervention) => {
      const interventionId = randomUUID();
      return [
        ctx.sql`
          INSERT INTO carecore_interventions (id, care_goal_id, title, instructions, frequency, responsible_role, day_parts,
            status, created_by)
          VALUES (${interventionId}, ${id}, ${intervention.title}, ${intervention.instructions}, ${intervention.frequency},
            ${intervention.responsibleRole}, ${intervention.dayParts}::text[], 'active', ${ctx.actor.id})`,
        log(ctx, plan.resident_id, "intervention", interventionId, "created", null, { goalId: id, ...intervention }),
      ];
    }),
  ]);
  return id;
}

export async function updateGoal(ctx: ApiContext, goalId: unknown, body: Record<string, unknown>) {
  const before = await loadGoal(ctx, goalId);
  if (before.status !== "active")
    throw new ApiError("Nur aktive Ziele können bearbeitet oder abgebrochen werden.", 409);
  if (body.status === "cancelled") {
    const reason = text(body.reason, 1000);
    if (!reason) throw new ApiError("Bitte den Grund für den Abbruch angeben.");
    await ctx.sql.transaction([
      ctx.sql`UPDATE carecore_care_goals SET status = 'cancelled', evaluation_note = ${reason}, updated_at = NOW() WHERE id = ${before.id}`,
      log(ctx, before.resident_id, "care_goal", before.id, "cancelled", { status: before.status }, { reason }),
    ]);
    return;
  }
  const goal = parseGoal(body);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_care_goals SET category = ${goal.category}, problem = ${goal.problem}, resources = ${goal.resources},
        statement = ${goal.statement}, target_date = ${goal.targetDate}, updated_at = NOW()
      WHERE id = ${before.id}`,
    log(
      ctx,
      before.resident_id,
      "care_goal",
      before.id,
      "updated",
      {
        category: before.category,
        problem: before.problem,
        resources: before.resources,
        statement: before.statement,
        targetDate: before.target_date,
      },
      goal,
    ),
  ]);
}

// Documents an evaluation; "achieved" closes the goal, otherwise a new review date keeps it running.
export async function evaluateGoal(ctx: ApiContext, goalId: unknown, body: Record<string, unknown>) {
  const goal = await loadGoal(ctx, goalId);
  if (goal.status !== "active") throw new ApiError("Nur aktive Ziele können evaluiert werden.", 409);
  const outcome = body.outcome as Outcome;
  if (!["achieved", "partially", "not_achieved", "ongoing"].includes(outcome))
    throw new ApiError("Bitte das Ergebnis wählen.");
  const note = text(body.note, 4000);
  if (!note) throw new ApiError("Bitte die Evaluation begründen (Beobachtungen, Veränderungen, Anpassungen).");
  const closeGoal = outcome === "achieved" || (outcome === "not_achieved" && body.closeGoal === true);
  const nextReviewOn = date(body.nextReviewOn);
  if (!closeGoal && !nextReviewOn) throw new ApiError("Bitte das nächste Überprüfungsdatum festlegen.");
  if (nextReviewOn && nextReviewOn < (await today(ctx)))
    throw new ApiError("Das nächste Überprüfungsdatum liegt in der Vergangenheit.");
  const status: GoalStatus = closeGoal ? (outcome === "achieved" ? "achieved" : "not_achieved") : "active";
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_care_goal_evaluations (id, care_goal_id, evaluated_by, outcome, note, next_review_on)
      VALUES (${id}, ${goal.id}, ${ctx.actor.id}, ${outcome}, ${note}, ${closeGoal ? null : nextReviewOn})`,
    ctx.sql`
      UPDATE carecore_care_goals SET status = ${status}, evaluation_note = ${note}, evaluated_at = NOW(),
        target_date = COALESCE(${closeGoal ? null : nextReviewOn}::date, target_date), updated_at = NOW()
      WHERE id = ${goal.id}`,
    log(
      ctx,
      goal.resident_id,
      "care_goal",
      goal.id,
      "evaluated",
      { status: goal.status },
      { outcome, note, nextReviewOn, status },
    ),
  ]);
}

// ---------------------------------------------------------- interventions

export function parseIntervention(body: Record<string, unknown>) {
  const intervention = {
    title: text(body.title, 220),
    instructions: text(body.instructions, 4000) || null,
    frequency: text(body.frequency, 100) || null,
    responsibleRole: text(body.responsibleRole, 100) || null,
    // Tageszeiten für den Durchführungsnachweis (leer: ohne Nachweis je Tageszeit).
    dayParts: DAY_PART_KEYS.filter((part) => Array.isArray(body.dayParts) && body.dayParts.includes(part)),
  };
  if (!intervention.title) throw new ApiError("Bitte die Massnahme benennen.");
  if (!intervention.frequency) throw new ApiError("Bitte die Häufigkeit angeben, z. B. „2× täglich“.");
  return intervention;
}

export async function addIntervention(ctx: ApiContext, goalId: unknown, body: Record<string, unknown>) {
  const goal = await loadGoal(ctx, goalId);
  if (goal.status !== "active") throw new ApiError("Massnahmen können nur zu aktiven Zielen ergänzt werden.", 409);
  const intervention = parseIntervention(body);
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`
      INSERT INTO carecore_interventions (id, care_goal_id, title, instructions, frequency, responsible_role, day_parts, status,
        created_by)
      VALUES (${id}, ${goal.id}, ${intervention.title}, ${intervention.instructions}, ${intervention.frequency},
        ${intervention.responsibleRole}, ${intervention.dayParts}::text[], 'active', ${ctx.actor.id})`,
    log(ctx, goal.resident_id, "intervention", id, "created", null, { goalId: goal.id, ...intervention }),
  ]);
  return id;
}

export async function updateIntervention(ctx: ApiContext, interventionIdInput: unknown, body: Record<string, unknown>) {
  const id = assertUuid(interventionIdInput, "Massnahme");
  const rows = (await ctx.sql`
    SELECT i.*, p.status AS plan_status, p.resident_id FROM carecore_interventions i
    JOIN carecore_care_goals g ON g.id = i.care_goal_id
    JOIN carecore_care_plans p ON p.id = g.care_plan_id
    JOIN carecore_residents r ON r.id = p.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    WHERE i.id = ${id}`) as Row[];
  const before = rows[0];
  if (!before) throw new ApiError("Massnahme nicht gefunden.", 404);
  if (!OPEN.includes(String(before.plan_status))) throw new ApiError("Der Pflegeplan ist abgeschlossen.", 409);
  if ("status" in body) {
    const status = body.status as InterventionStatus;
    if (!["active", "paused", "completed", "cancelled"].includes(status)) throw new ApiError("Ungültiger Status.");
    if (before.status === status) return;
    await ctx.sql.transaction([
      ctx.sql`UPDATE carecore_interventions SET status = ${status}, updated_at = NOW() WHERE id = ${id}`,
      log(ctx, before.resident_id, "intervention", id, `status_${status}`, { status: before.status }, { status }),
    ]);
    return;
  }
  const intervention = parseIntervention(body);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_interventions SET title = ${intervention.title}, instructions = ${intervention.instructions},
        frequency = ${intervention.frequency}, responsible_role = ${intervention.responsibleRole},
        day_parts = ${intervention.dayParts}::text[], updated_at = NOW()
      WHERE id = ${id}`,
    log(
      ctx,
      before.resident_id,
      "intervention",
      id,
      "updated",
      {
        title: before.title,
        instructions: before.instructions,
        frequency: before.frequency,
        responsibleRole: before.responsible_role,
        dayParts: before.day_parts,
      },
      intervention,
    ),
  ]);
}
