import { randomUUID } from "node:crypto";
import { ApiError, assertResident, assertUuid, iso, num, text, type ApiContext, type Row } from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { nutritionTrends } from "@/lib/nutrition-trends";
import { receiptStatements, withReceipt } from "@/lib/request-receipts";
import { initials } from "@/lib/medication-shared";
import {
  ASSISTANCE,
  DIETS,
  MEALS,
  MEAL_RHYTHMS,
  PORTIONS,
  TEXTURES,
  type FluidEntry,
  type MealEntry,
  type NutritionPlan,
  type NutritionResident,
  type ResidentNutrition,
} from "@/lib/nutrition-shared";
import { auditOrigin } from "@/lib/audit-origin";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const oneOf = (options: readonly string[], value: unknown) =>
  typeof value === "string" && options.includes(value) ? value : null;

// The requested day (organization time zone) or today.
async function dayOf(ctx: ApiContext, input: unknown) {
  if (typeof input === "string" && DATE.test(input)) return input;
  const rows =
    await ctx.sql`SELECT to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS d FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}`;
  return String(rows[0].d);
}

function mapPlan(row: Row): NutritionPlan {
  return {
    id: String(row.id),
    diet: (row.diet as string | null) ?? null,
    texture: (row.texture as string | null) ?? null,
    allergies: (row.allergies as string | null) ?? null,
    fluidTargetMl: num(row.daily_fluid_target_ml),
    fluidLimitMl: num(row.fluid_limit_ml),
    calorieTarget: num(row.daily_calorie_target),
    mealRhythm: (row.meal_rhythm as string | null) ?? null,
    assistance: (row.assistance as string | null) ?? null,
    preferences: (row.preferences as string | null) ?? null,
    instructions: (row.instructions as string | null) ?? null,
    updatedAt: iso(row.updated_at) ?? "",
    updatedBy: (row.updated_by as string | null) ?? null,
  };
}

// --------------------------------------------------------------- overview

export async function nutritionOverview(ctx: ApiContext, dateInput: unknown) {
  const date = await dayOf(ctx, dateInput);
  const [rows, units] = (await Promise.all([
    ctx.sql`
      SELECT r.id, r.first_name, r.last_name, COALESCE(ro.name, '') AS room, COALESCE(cu.name, '') AS care_unit,
        p.id AS plan_id, p.diet, p.texture, p.daily_fluid_target_ml, p.fluid_limit_ml,
        COALESCE(f.total, 0)::int AS fluid_total, f.last_at, COALESCE(m.logged, 0)::int AS meals_logged, COALESCE(m.low, 0)::int AS low_meals
      FROM carecore_residents r
      CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
      LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
      LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
      LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
      LEFT JOIN carecore_nutrition_plans p ON p.resident_id = r.id AND p.active
      LEFT JOIN LATERAL (
        SELECT SUM(amount_ml) AS total, MAX(consumed_at) AS last_at FROM carecore_fluid_entries
        WHERE resident_id = r.id AND deleted_at IS NULL AND (consumed_at AT TIME ZONE org.tz)::date = ${date}::date) f ON TRUE
      LEFT JOIN LATERAL (
        SELECT COUNT(*) AS logged, COUNT(*) FILTER (WHERE portion_percent <= 25) AS low FROM carecore_meal_entries
        WHERE resident_id = r.id AND deleted_at IS NULL AND (eaten_at AT TIME ZONE org.tz)::date = ${date}::date) m ON TRUE
      WHERE r.organization_id = ${ctx.actor.organizationId} AND r.status = 'active'
      ORDER BY r.last_name, r.first_name`,
    ctx.sql`
      SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites si ON si.id = cu.site_id
      WHERE si.organization_id = ${ctx.actor.organizationId} AND cu.active ORDER BY cu.name`,
  ])) as [Row[], Row[]];
  const trends = await nutritionTrends(
    ctx,
    rows.map((row) => String(row.id)),
    date,
  );
  return {
    date,
    careUnits: units.map((u) => ({ id: String(u.id), name: String(u.name) })),
    residents: rows.map((row): NutritionResident => {
      const name = `${row.first_name} ${row.last_name}`;
      return {
        id: String(row.id),
        name,
        initials: initials(name),
        room: String(row.room),
        careUnit: String(row.care_unit),
        hasPlan: Boolean(row.plan_id),
        diet: (row.diet as string | null) ?? null,
        texture: (row.texture as string | null) ?? null,
        fluidTargetMl: num(row.daily_fluid_target_ml),
        fluidLimitMl: num(row.fluid_limit_ml),
        fluidTotalMl: Number(row.fluid_total),
        lastFluidAt: iso(row.last_at),
        mealsLogged: Number(row.meals_logged),
        lowMeals: Number(row.low_meals),
        trends: trends.get(String(row.id)) ?? [],
      };
    }),
  };
}

export async function residentNutrition(
  ctx: ApiContext,
  residentIdInput: unknown,
  dateInput: unknown,
): Promise<ResidentNutrition & { date: string }> {
  const residentId = await assertResident(ctx, residentIdInput);
  const date = await dayOf(ctx, dateInput);
  const [plans, fluids, meals, week, weights] = (await Promise.all([
    ctx.sql`
      SELECT p.*, u.display_name AS updated_by FROM carecore_nutrition_plans p LEFT JOIN carecore_users u ON u.id = p.created_by
      WHERE p.resident_id = ${residentId} AND p.active LIMIT 1`,
    ctx.sql`
      SELECT f.id, f.amount_ml, f.beverage, f.consumed_at, f.note, u.display_name AS entered_by
      FROM carecore_fluid_entries f LEFT JOIN carecore_users u ON u.id = f.entered_by
      CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
      WHERE f.resident_id = ${residentId} AND f.deleted_at IS NULL AND (f.consumed_at AT TIME ZONE org.tz)::date = ${date}::date
      ORDER BY f.consumed_at`,
    ctx.sql`
      SELECT m.id, m.meal, m.portion_percent, m.eaten_at, m.note, u.display_name AS entered_by
      FROM carecore_meal_entries m LEFT JOIN carecore_users u ON u.id = m.entered_by
      CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
      WHERE m.resident_id = ${residentId} AND m.deleted_at IS NULL AND (m.eaten_at AT TIME ZONE org.tz)::date = ${date}::date
      ORDER BY m.eaten_at`,
    ctx.sql`
      SELECT to_char(d.day, 'YYYY-MM-DD') AS date, COALESCE(SUM(f.amount_ml), 0)::int AS total
      FROM generate_series(${date}::date - 6, ${date}::date, INTERVAL '1 day') AS d(day)
      CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
      LEFT JOIN carecore_fluid_entries f ON f.resident_id = ${residentId} AND f.deleted_at IS NULL
        AND (f.consumed_at AT TIME ZONE org.tz)::date = d.day::date
      GROUP BY d.day ORDER BY d.day`,
    ctx.sql`
      SELECT value, measured_at FROM carecore_vital_measurements
      WHERE resident_id = ${residentId} AND metric = 'Gewicht' AND measured_at > NOW() - INTERVAL '60 days'
      ORDER BY measured_at DESC`,
  ])) as Row[][];
  const trends = (await nutritionTrends(ctx, [residentId], date)).get(residentId) ?? [];
  // Weight change: latest value compared with the oldest measurement of the last 30 days.
  const latest = weights[0];
  const monthAgo = weights
    .filter((w) => new Date(String(iso(w.measured_at))).getTime() > Date.now() - 30 * 86_400_000)
    .at(-1);
  return {
    date,
    plan: plans[0] ? mapPlan(plans[0]) : null,
    fluids: fluids.map((row): FluidEntry => ({
      id: String(row.id),
      amountMl: Number(row.amount_ml),
      beverage: (row.beverage as string | null) ?? null,
      consumedAt: iso(row.consumed_at) ?? "",
      note: (row.note as string | null) ?? null,
      enteredBy: (row.entered_by as string | null) ?? null,
    })),
    meals: meals.map((row): MealEntry => ({
      id: String(row.id),
      meal: String(row.meal),
      portionPercent: Number(row.portion_percent),
      eatenAt: iso(row.eaten_at) ?? "",
      note: (row.note as string | null) ?? null,
      enteredBy: (row.entered_by as string | null) ?? null,
    })),
    week: week.map((row) => ({ date: String(row.date), totalMl: Number(row.total) })),
    weight: latest
      ? {
          latestKg: Number(latest.value),
          measuredAt: iso(latest.measured_at) ?? "",
          changeKg30d:
            monthAgo && monthAgo !== latest
              ? Math.round((Number(latest.value) - Number(monthAgo.value)) * 10) / 10
              : null,
        }
      : null,
    trends,
  };
}

// ------------------------------------------------------------------- plan

// Saving replaces the active plan; the previous one stays as inactive history.
export async function savePlan(ctx: ApiContext, residentIdInput: unknown, body: Record<string, unknown>) {
  const residentId = await assertResident(ctx, residentIdInput);
  const amount = (value: unknown, max: number, label: string) => {
    if (value === null || value === undefined || value === "") return null;
    if (!Number.isInteger(value) || (value as number) <= 0 || (value as number) > max)
      throw new ApiError(`${label} muss zwischen 1 und ${max} liegen.`);
    return value as number;
  };
  const plan = {
    diet: oneOf(DIETS, body.diet),
    texture: oneOf(TEXTURES, body.texture),
    allergies: text(body.allergies, 2000) || null,
    fluidTargetMl: amount(body.fluidTargetMl, 5000, "Das Trinkziel (ml)"),
    fluidLimitMl: amount(body.fluidLimitMl, 5000, "Die Trinkmengenbegrenzung (ml)"),
    calorieTarget: amount(body.calorieTarget, 5000, "Der Energiebedarf (kcal)"),
    mealRhythm: oneOf(MEAL_RHYTHMS, body.mealRhythm),
    assistance: oneOf(ASSISTANCE, body.assistance),
    preferences: text(body.preferences, 2000) || null,
    instructions: text(body.instructions, 4000) || null,
  };
  if (!plan.diet || !plan.texture) throw new ApiError("Bitte Kostform und Konsistenz wählen.");
  if (plan.fluidTargetMl && plan.fluidLimitMl && plan.fluidTargetMl > plan.fluidLimitMl)
    throw new ApiError("Das Trinkziel liegt über der Trinkmengenbegrenzung.");
  const before =
    await ctx.sql`SELECT * FROM carecore_nutrition_plans WHERE resident_id = ${residentId} AND active LIMIT 1`;
  const id = randomUUID();
  await ctx.sql.transaction([
    ctx.sql`UPDATE carecore_nutrition_plans SET active = FALSE, updated_at = NOW() WHERE resident_id = ${residentId} AND active`,
    ctx.sql`
      INSERT INTO carecore_nutrition_plans (id, resident_id, diet, texture, allergies, daily_fluid_target_ml, fluid_limit_ml, daily_calorie_target,
        meal_rhythm, assistance, preferences, instructions, active, created_by)
      VALUES (${id}, ${residentId}, ${plan.diet}, ${plan.texture}, ${plan.allergies}, ${plan.fluidTargetMl}, ${plan.fluidLimitMl}, ${plan.calorieTarget},
        ${plan.mealRhythm}, ${plan.assistance}, ${plan.preferences}, ${plan.instructions}, TRUE, ${ctx.actor.id})`,
    residentAudit(ctx.sql, ctx.actor, {
      residentId,
      entityType: "nutrition_plan",
      entityId: id,
      action: before[0] ? "replaced" : "created",
      before: (before[0] as Record<string, unknown> | undefined) ?? null,
      after: plan,
    }),
  ]);
  return id;
}

// ------------------------------------------------------------ fluid / meals

function timestamp(input: unknown) {
  const at = typeof input === "string" && !Number.isNaN(Date.parse(input)) ? new Date(input) : new Date();
  if (at.getTime() > Date.now() + 5 * 60_000) throw new ApiError("Der Zeitpunkt liegt in der Zukunft.");
  if (at.getTime() < Date.now() - 3 * 86_400_000)
    throw new ApiError("Einträge können höchstens 3 Tage rückwirkend erfasst werden.");
  return at.toISOString();
}

export async function addFluid(ctx: ApiContext, body: Record<string, unknown>, requestId: string | null = null) {
  const residentId = await assertResident(ctx, body.residentId);
  const amount = body.amountMl;
  if (!Number.isInteger(amount) || (amount as number) < 10 || (amount as number) > 1500)
    throw new ApiError("Bitte eine Trinkmenge zwischen 10 und 1500 ml angeben.");
  const id = randomUUID();
  const consumedAt = timestamp(body.consumedAt);
  const { repeated } = await withReceipt(() =>
    ctx.sql.transaction([
      ctx.sql`
      INSERT INTO carecore_fluid_entries (id, resident_id, entered_by, consumed_at, amount_ml, beverage, note)
      VALUES (${id}, ${residentId}, ${ctx.actor.id}, ${consumedAt}, ${amount as number}, ${text(body.beverage, 120) || null}, ${text(body.note, 1000) || null})`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "fluid_entry",
        entityId: id,
        action: "created",
        after: { amountMl: amount, consumedAt },
      }),
      ...receiptStatements(ctx, requestId),
    ]),
  );
  return repeated ? null : id;
}

export async function addMeal(ctx: ApiContext, body: Record<string, unknown>, requestId: string | null = null) {
  const residentId = await assertResident(ctx, body.residentId);
  const meal = oneOf(MEALS, body.meal);
  if (!meal) throw new ApiError("Bitte die Mahlzeit wählen.");
  const portion = body.portionPercent;
  if (!(PORTIONS as readonly number[]).includes(portion as number))
    throw new ApiError("Bitte die gegessene Menge wählen.");
  const note = text(body.note, 1000);
  if ((portion as number) <= 25 && !note)
    throw new ApiError(
      "Bei wenig oder nichts gegessen bitte den Grund notieren (z. B. Appetitlosigkeit, Schluckbeschwerden).",
    );
  const id = randomUUID();
  const eatenAt = timestamp(body.eatenAt);
  const { repeated } = await withReceipt(() =>
    ctx.sql.transaction([
      ctx.sql`
      INSERT INTO carecore_meal_entries (id, resident_id, entered_by, eaten_at, meal, portion_percent, note)
      VALUES (${id}, ${residentId}, ${ctx.actor.id}, ${eatenAt}, ${meal}, ${portion as number}, ${note || null})`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId,
        entityType: "meal_entry",
        entityId: id,
        action: "created",
        after: { meal, portionPercent: portion, eatenAt },
      }),
      ...receiptStatements(ctx, requestId),
    ]),
  );
  return repeated ? null : id;
}

// Wrong entries are hidden with a reason, never deleted.
export async function hideEntry(ctx: ApiContext, kind: "fluid" | "meal", idInput: unknown, reasonInput: unknown) {
  const id = assertUuid(idInput, "Eintrag");
  const reason = text(reasonInput, 1000);
  if (!reason) throw new ApiError("Bitte den Grund für die Korrektur angeben.");
  // Ausblenden und Protokoll in einer Anweisung; das Protokoll nennt den Bewohner für die Akte.
  const rows = (
    kind === "fluid"
      ? await ctx.sql`
          WITH h AS (
            UPDATE carecore_fluid_entries e SET deleted_at = NOW(), deleted_by = ${ctx.actor.id}, delete_reason = ${reason}
            FROM carecore_residents r WHERE e.id = ${id} AND e.deleted_at IS NULL AND r.id = e.resident_id AND r.organization_id = ${ctx.actor.organizationId}
            RETURNING e.id, e.resident_id)
          INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
          SELECT ${randomUUID()}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${auditOrigin(ctx.actor).sessionId}, ${auditOrigin(ctx.actor).userAgent}, 'fluid_entry', h.id, 'hidden',
            jsonb_build_object('residentId', h.resident_id, 'reason', ${reason}::text)
          FROM h RETURNING entity_id`
      : await ctx.sql`
          WITH h AS (
            UPDATE carecore_meal_entries e SET deleted_at = NOW(), deleted_by = ${ctx.actor.id}, delete_reason = ${reason}
            FROM carecore_residents r WHERE e.id = ${id} AND e.deleted_at IS NULL AND r.id = e.resident_id AND r.organization_id = ${ctx.actor.organizationId}
            RETURNING e.id, e.resident_id)
          INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data)
          SELECT ${randomUUID()}, ${ctx.actor.organizationId}, ${ctx.actor.id}, ${auditOrigin(ctx.actor).sessionId}, ${auditOrigin(ctx.actor).userAgent}, 'meal_entry', h.id, 'hidden',
            jsonb_build_object('residentId', h.resident_id, 'reason', ${reason}::text)
          FROM h RETURNING entity_id`
  ) as Row[];
  if (!rows[0]) throw new ApiError("Eintrag nicht gefunden.", 404);
}
