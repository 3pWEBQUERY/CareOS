import { type ApiContext, type Row } from "@/lib/api-context";
import { type EvaluationStats, type GoalListItem } from "@/lib/care-planning-shared";
import { goalsOf } from "./care-planning";

// ------------------------------------------------------------- house views

export async function listGoals(ctx: ApiContext): Promise<GoalListItem[]> {
  const plans = (await ctx.sql`
    SELECT p.id, p.owner_user_id, u.display_name AS owner_name, r.id AS resident_id, r.first_name || ' ' || r.last_name AS resident_name,
      COALESCE(ro.name, '') AS room
    FROM carecore_care_plans p
    JOIN carecore_residents r ON r.id = p.resident_id AND r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
    LEFT JOIN LATERAL (SELECT room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
    LEFT JOIN carecore_users u ON u.id = p.owner_user_id
    WHERE p.status IN ('draft', 'active', 'review')`) as Row[];
  const goals = await goalsOf(
    ctx,
    plans.map((p) => String(p.id)),
  );
  return plans
    .flatMap((plan) =>
      (goals.get(String(plan.id)) ?? [])
        .filter((goal) => goal.status === "active")
        .map((goal) => ({
          ...goal,
          residentId: String(plan.resident_id),
          residentName: String(plan.resident_name),
          room: String(plan.room),
          ownerId: (plan.owner_user_id as string | null) ?? null,
          ownerName: (plan.owner_name as string | null) ?? null,
          lastEvaluation: goal.evaluations[0] ?? null,
        })),
    )
    .sort((a, b) => (a.targetDate ?? "9999").localeCompare(b.targetDate ?? "9999"));
}

export async function evaluationStats(ctx: ApiContext, daysInput: unknown): Promise<EvaluationStats> {
  const days = [30, 90, 365].includes(Number(daysInput)) ? Number(daysInput) : 90;
  const [categories, due] = (await Promise.all([
    ctx.sql`
      SELECT g.category,
        COUNT(DISTINCT g.id) FILTER (WHERE g.status = 'active')::int AS active_goals,
        COUNT(e.id)::int AS evaluations,
        COUNT(e.id) FILTER (WHERE e.outcome = 'achieved')::int AS achieved,
        COUNT(e.id) FILTER (WHERE e.outcome = 'partially')::int AS partially,
        COUNT(e.id) FILTER (WHERE e.outcome = 'not_achieved')::int AS not_achieved,
        COUNT(e.id) FILTER (WHERE e.outcome = 'ongoing')::int AS ongoing
      FROM carecore_care_goals g
      JOIN carecore_care_plans p ON p.id = g.care_plan_id
      JOIN carecore_residents r ON r.id = p.resident_id AND r.organization_id = ${ctx.actor.organizationId}
      LEFT JOIN carecore_care_goal_evaluations e ON e.care_goal_id = g.id AND e.evaluated_at > NOW() - make_interval(days => ${days})
      WHERE g.status <> 'cancelled'
      GROUP BY g.category ORDER BY g.category`,
    ctx.sql`
      SELECT * FROM (
        SELECT 'plan' AS kind, p.id, r.id AS resident_id, r.first_name || ' ' || r.last_name AS resident_name,
          'Pflegeplan überprüfen' AS title, to_char(p.review_on, 'YYYY-MM-DD') AS due_date
        FROM carecore_care_plans p JOIN carecore_residents r ON r.id = p.resident_id AND r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
        WHERE p.status IN ('draft', 'active', 'review') AND p.review_on IS NOT NULL
        UNION ALL
        SELECT 'goal', g.id, r.id, r.first_name || ' ' || r.last_name, g.statement, to_char(g.target_date, 'YYYY-MM-DD')
        FROM carecore_care_goals g JOIN carecore_care_plans p ON p.id = g.care_plan_id
        JOIN carecore_residents r ON r.id = p.resident_id AND r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
        WHERE g.status = 'active' AND p.status IN ('draft', 'active', 'review') AND g.target_date IS NOT NULL
      ) due
      CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
      WHERE due.due_date::date <= (NOW() AT TIME ZONE org.tz)::date + 14
      ORDER BY due.due_date LIMIT 50`,
  ])) as [Row[], Row[]];
  const byCategory = categories.map((row) => ({
    category: String(row.category),
    activeGoals: Number(row.active_goals),
    evaluations: Number(row.evaluations),
    achieved: Number(row.achieved),
    partially: Number(row.partially),
    notAchieved: Number(row.not_achieved),
    ongoing: Number(row.ongoing),
  }));
  const sum = (key: keyof (typeof byCategory)[number]) =>
    byCategory.reduce((total, row) => total + Number(row[key]), 0);
  return {
    days,
    byCategory,
    totals: {
      activeGoals: sum("activeGoals"),
      evaluations: sum("evaluations"),
      achieved: sum("achieved"),
      partially: sum("partially"),
      notAchieved: sum("notAchieved"),
      ongoing: sum("ongoing"),
    },
    due: due.map((row) => ({
      kind: row.kind as "plan" | "goal",
      id: String(row.id),
      residentId: String(row.resident_id),
      residentName: String(row.resident_name),
      title: String(row.title),
      date: String(row.due_date),
    })),
  };
}
