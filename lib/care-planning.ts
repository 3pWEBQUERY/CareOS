import { randomUUID } from "node:crypto";
import { DAY_PART_KEYS } from "@/lib/intervention-proofs-shared";
import { readTerms } from "@/lib/settings";
import { ApiError, assertResident, assertUuid, iso, text, type ApiContext, type Row } from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { careLevelError, isCareLevel } from "@/lib/country";
import { organizationCountry } from "@/lib/organization-country";
import { initials } from "@/lib/medication-shared";
import {
  type CareGoal,
  type CarePlan,
  type GoalEvaluation,
  type GoalStatus,
  type Intervention,
  type InterventionStatus,
  type Outcome,
  type PlanStatus,
  type PlanningResident,
} from "@/lib/care-planning-shared";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const OPEN = ["draft", "active", "review"];
export const date = (value: unknown) => (typeof value === "string" && DATE.test(value) ? value : null);
const day = (value: unknown) => (value ? (iso(value) ?? "").slice(0, 10) || null : null);

export async function today(ctx: ApiContext) {
  const rows =
    await ctx.sql`SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS d FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`;
  return String(rows[0].d);
}

async function assertStaff(ctx: ApiContext, userId: unknown) {
  if (!userId) return null;
  const id = assertUuid(userId, "Bezugsperson");
  const rows =
    await ctx.sql`SELECT user_id FROM carecore_user_profiles WHERE user_id = ${id} AND organization_id = ${ctx.actor.organizationId}`;
  if (!rows[0]) throw new ApiError("Die Bezugsperson gehört nicht zu dieser Organisation.");
  return id;
}

// ---------------------------------------------------------------- overview

export async function planningOverview(ctx: ApiContext) {
  const [residents, staff] = (await Promise.all([
    ctx.sql`
      SELECT r.id, r.first_name, r.last_name, COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS care_unit,
        p.id AS plan_id, p.status AS plan_status, to_char(p.review_on, 'YYYY-MM-DD') AS review_on,
        (p.review_on IS NOT NULL AND p.review_on <= (NOW() AT TIME ZONE org.tz)::date) AS review_due,
        u.display_name AS owner_name,
        (SELECT COUNT(*)::int FROM carecore_care_goals g WHERE g.care_plan_id = p.id AND g.status = 'active') AS active_goals,
        (SELECT COUNT(*)::int FROM carecore_care_goals g WHERE g.care_plan_id = p.id AND g.status = 'active'
          AND g.target_date <= (NOW() AT TIME ZONE org.tz)::date) AS goals_due
      FROM carecore_residents r
      CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
      LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      LEFT JOIN carecore_care_plans p ON p.resident_id = r.id AND p.status IN ('draft', 'active', 'review')
      LEFT JOIN carecore_users u ON u.id = p.owner_user_id
      WHERE r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
      ORDER BY r.last_name, r.first_name`,
    staffOf(ctx),
  ])) as [Row[], Array<{ id: string; name: string }>];
  return {
    residents: residents.map((row): PlanningResident => {
      const name = `${row.first_name} ${row.last_name}`;
      return {
        id: String(row.id),
        name,
        initials: initials(name),
        room: String(row.room),
        careUnit: String(row.care_unit),
        planId: (row.plan_id as string | null) ?? null,
        planStatus: (row.plan_status as PlanStatus | null) ?? null,
        reviewOn: (row.review_on as string | null) ?? null,
        reviewDue: Boolean(row.review_due),
        activeGoals: Number(row.active_goals ?? 0),
        goalsDue: Number(row.goals_due ?? 0),
        ownerName: (row.owner_name as string | null) ?? null,
      };
    }),
    staff,
  };
}

// Active staff of the organization, e.g. to choose the primary nurse of a plan.
export async function staffOf(ctx: ApiContext) {
  const rows = (await ctx.sql`
    SELECT u.id, u.display_name AS name FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
    WHERE p.organization_id = ${ctx.actor.organizationId} AND u.active ORDER BY u.display_name`) as Row[];
  return rows.map((row) => ({ id: String(row.id), name: String(row.name) }));
}

// ------------------------------------------------------------ plan detail

function mapEvaluation(row: Row): GoalEvaluation {
  return {
    id: String(row.id),
    outcome: row.outcome as Outcome,
    note: String(row.note),
    evaluatedAt: iso(row.evaluated_at) ?? "",
    evaluatedBy: (row.evaluated_by as string | null) ?? null,
    nextReviewOn: day(row.next_review_on),
  };
}

function mapIntervention(row: Row): Intervention {
  return {
    id: String(row.id),
    goalId: String(row.care_goal_id),
    title: String(row.title),
    instructions: (row.instructions as string | null) ?? null,
    frequency: (row.frequency as string | null) ?? null,
    responsibleRole: (row.responsible_role as string | null) ?? null,
    dayParts: DAY_PART_KEYS.filter((part) => Array.isArray(row.day_parts) && row.day_parts.includes(part)),
    status: row.status as InterventionStatus,
  };
}

export async function goalsOf(ctx: ApiContext, planIds: string[]) {
  if (!planIds.length) return new Map<string, CareGoal[]>();
  const [goals, interventions, evaluations] = (await Promise.all([
    ctx.sql`
      SELECT g.*, to_char(g.target_date, 'YYYY-MM-DD') AS target_day,
        (g.status = 'active' AND g.target_date <= (NOW() AT TIME ZONE org.tz)::date) AS review_due
      FROM carecore_care_goals g
      CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
      WHERE g.care_plan_id = ANY(${planIds}::uuid[]) AND g.status <> 'cancelled'
      ORDER BY (g.status <> 'active'), g.target_date NULLS LAST, g.created_at`,
    ctx.sql`
      SELECT i.* FROM carecore_interventions i JOIN carecore_care_goals g ON g.id = i.care_goal_id
      WHERE g.care_plan_id = ANY(${planIds}::uuid[]) AND i.status <> 'cancelled'
      ORDER BY (i.status <> 'active'), i.created_at`,
    ctx.sql`
      SELECT e.*, u.display_name AS evaluated_by FROM carecore_care_goal_evaluations e
      JOIN carecore_care_goals g ON g.id = e.care_goal_id
      LEFT JOIN carecore_users u ON u.id = e.evaluated_by
      WHERE g.care_plan_id = ANY(${planIds}::uuid[])
      ORDER BY e.evaluated_at DESC`,
  ])) as [Row[], Row[], Row[]];
  const byPlan = new Map<string, CareGoal[]>();
  for (const row of goals) {
    const goal: CareGoal = {
      id: String(row.id),
      planId: String(row.care_plan_id),
      category: String(row.category),
      problem: (row.problem as string | null) ?? null,
      resources: (row.resources as string | null) ?? null,
      statement: String(row.statement),
      targetDate: (row.target_day as string | null) ?? null,
      status: row.status as GoalStatus,
      reviewDue: Boolean(row.review_due),
      interventions: interventions.filter((i) => i.care_goal_id === row.id).map(mapIntervention),
      evaluations: evaluations.filter((e) => e.care_goal_id === row.id).map(mapEvaluation),
    };
    byPlan.set(goal.planId, [...(byPlan.get(goal.planId) ?? []), goal]);
  }
  return byPlan;
}

export async function residentPlan(
  ctx: ApiContext,
  residentIdInput: unknown,
): Promise<{ plan: CarePlan | null; closedPlans: number }> {
  const residentId = await assertResident(ctx, residentIdInput);
  const rows = (await ctx.sql`
    SELECT p.*, u.display_name AS owner_name, to_char(p.starts_on, 'YYYY-MM-DD') AS starts_day, to_char(p.review_on, 'YYYY-MM-DD') AS review_day,
      (p.review_on IS NOT NULL AND p.review_on <= (NOW() AT TIME ZONE org.tz)::date) AS review_due,
      (SELECT COUNT(*)::int FROM carecore_care_plans c WHERE c.resident_id = p.resident_id AND c.status IN ('closed', 'archived')) AS closed_plans
    FROM carecore_care_plans p
    CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
    LEFT JOIN carecore_users u ON u.id = p.owner_user_id
    WHERE p.resident_id = ${residentId} AND p.status IN ('draft', 'active', 'review')
    LIMIT 1`) as Row[];
  const row = rows[0];
  if (!row) {
    const closed =
      await ctx.sql`SELECT COUNT(*)::int AS n FROM carecore_care_plans WHERE resident_id = ${residentId} AND status IN ('closed', 'archived')`;
    return { plan: null, closedPlans: Number(closed[0].n) };
  }
  const goals = await goalsOf(ctx, [String(row.id)]);
  return {
    closedPlans: Number(row.closed_plans),
    plan: {
      id: String(row.id),
      residentId,
      status: row.status as PlanStatus,
      careLevel: (row.care_level as string | null) ?? null,
      focus: (row.focus as string | null) ?? null,
      ownerId: (row.owner_user_id as string | null) ?? null,
      ownerName: (row.owner_name as string | null) ?? null,
      startsOn: String(row.starts_day),
      reviewOn: (row.review_day as string | null) ?? null,
      reviewDue: Boolean(row.review_due),
      updatedAt: iso(row.updated_at) ?? "",
      goals: goals.get(String(row.id)) ?? [],
    },
  };
}

// ------------------------------------------------------------------ plans

function parsePlan(body: Record<string, unknown>) {
  const plan = {
    careLevel: text(body.careLevel, 80) || null,
    focus: text(body.focus, 4000),
    startsOn: date(body.startsOn),
    reviewOn: date(body.reviewOn),
  };
  if (!plan.focus) throw new ApiError("Bitte den Pflegefokus beschreiben.");
  if (!plan.startsOn) throw new ApiError("Bitte das Startdatum angeben.");
  if (!plan.reviewOn) throw new ApiError("Bitte ein Überprüfungsdatum festlegen.");
  if (plan.reviewOn < plan.startsOn) throw new ApiError("Die Überprüfung liegt vor dem Startdatum.");
  return plan;
}

export async function loadPlan(ctx: ApiContext, planIdInput: unknown) {
  const id = assertUuid(planIdInput, "Pflegeplan");
  const rows = (await ctx.sql`
    SELECT p.* FROM carecore_care_plans p JOIN carecore_residents r ON r.id = p.resident_id AND r.organization_id = ${ctx.actor.organizationId}
    WHERE p.id = ${id}`) as Row[];
  if (!rows[0]) throw new ApiError("Pflegeplan nicht gefunden.", 404);
  return rows[0];
}

export function assertOpen(plan: Row) {
  if (!OPEN.includes(String(plan.status))) throw new ApiError("Der Pflegeplan ist abgeschlossen.", 409);
}

export async function createPlan(ctx: ApiContext, body: Record<string, unknown>) {
  const residentId = await assertResident(ctx, body.residentId);
  const plan = parsePlan(body);
  const country = await organizationCountry(ctx);
  if (!isCareLevel(country, plan.careLevel)) throw new ApiError(careLevelError(country));
  const ownerId = await assertStaff(ctx, body.ownerId);
  const id = randomUUID();
  try {
    await ctx.sql.transaction([
      ctx.sql`
        INSERT INTO carecore_care_plans (id, resident_id, owner_user_id, status, care_level, focus, starts_on, review_on)
        VALUES (${id}, ${residentId}, ${ownerId}, 'active', ${plan.careLevel}, ${plan.focus}, ${plan.startsOn}, ${plan.reviewOn})`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "care_plan",
        entityId: id,
        action: "created",
        after: { ownerId, ...plan },
      }),
    ]);
  } catch (error) {
    if (String(error).includes("carecore_care_plans_one_open_idx"))
      throw new ApiError(
        `Für diesen ${(await readTerms(ctx)).oneOblique} besteht bereits ein offener Pflegeplan.`,
        409,
      );
    throw error;
  }
  return id;
}

export async function updatePlan(ctx: ApiContext, planId: unknown, body: Record<string, unknown>) {
  const before = await loadPlan(ctx, planId);
  if ("status" in body) {
    const status = body.status;
    if (status !== "active" && status !== "review" && status !== "closed") throw new ApiError("Ungültiger Status.");
    const reason = text(body.reason, 1000);
    if (status === "closed" && !reason) throw new ApiError("Bitte den Grund für den Abschluss angeben.");
    assertOpen(before);
    if (before.status === status) return;
    await ctx.sql.transaction([
      ctx.sql`
        UPDATE carecore_care_plans SET status = ${status}, closed_at = CASE WHEN ${status} = 'closed' THEN NOW() END,
          closed_reason = CASE WHEN ${status} = 'closed' THEN ${reason} END, updated_at = NOW()
        WHERE id = ${before.id}`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: String(before.resident_id),
        entityType: "care_plan",
        entityId: String(before.id),
        action: `status_${status}`,
        before: { status: before.status },
        after: { status, reason: reason || null },
      }),
    ]);
    return;
  }
  assertOpen(before);
  const plan = parsePlan(body);
  // Eine gespeicherte Einstufung aus einem anderen System (z. B. vor einem Wechsel des Landes) bleibt erlaubt.
  const country = await organizationCountry(ctx);
  if (plan.careLevel !== before.care_level && !isCareLevel(country, plan.careLevel))
    throw new ApiError(careLevelError(country));
  const ownerId = await assertStaff(ctx, body.ownerId);
  await ctx.sql.transaction([
    ctx.sql`
      UPDATE carecore_care_plans SET owner_user_id = ${ownerId}, care_level = ${plan.careLevel}, focus = ${plan.focus},
        starts_on = ${plan.startsOn}, review_on = ${plan.reviewOn}, updated_at = NOW()
      WHERE id = ${before.id}`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId: String(before.resident_id),
      entityType: "care_plan",
      entityId: String(before.id),
      action: "updated",
      before: {
        ownerId: before.owner_user_id,
        careLevel: before.care_level,
        focus: before.focus,
        startsOn: before.starts_on,
        reviewOn: before.review_on,
      },
      after: { ownerId, ...plan },
    }),
  ]);
}
