import type { ApiContext, Row } from "@/lib/api-context";
import { formatMl, type NutritionTrend } from "@/lib/nutrition-shared";
import { readSettings } from "@/lib/settings";

const kg = (value: number) => `${value.toLocaleString("de-CH", { maximumFractionDigits: 1 })} kg`;

// Trendhinweise je Bewohner nach den Grenzen der Einrichtung. Ohne festgelegte Grenze gibt es keinen Hinweis.
// - Gewicht: erste und letzte Messung im Beobachtungszeitraum, Verlust in % der ersten Messung.
// - Trinkmenge: persönliches Trinkziel aus dem Ernährungsplan an allen der letzten N abgeschlossenen Tage
//   vor `date` verfehlt; Tage vor dem ersten Aufenthalt zählen nicht.
export async function nutritionTrends(ctx: ApiContext, residentIds: string[], date: string) {
  const trends = new Map<string, NutritionTrend[]>();
  if (!residentIds.length) return trends;
  const settings = await readSettings(ctx);
  const lossPercent = settings.weightLossPercent.enabled ? settings.weightLossPercent.value : null;
  const lossDays = settings.weightLossDays.enabled ? settings.weightLossDays.value : null;
  const behindDays = settings.fluidBehindDays.enabled ? settings.fluidBehindDays.value : null;
  const add = (id: string, trend: NutritionTrend) => trends.set(id, [...(trends.get(id) ?? []), trend]);

  const [weights, fluids] = (await Promise.all([
    lossPercent && lossDays
      ? ctx.sql`
        SELECT resident_id, (array_agg(value ORDER BY measured_at))[1] AS first_kg,
          (array_agg(value ORDER BY measured_at DESC))[1] AS latest_kg
        FROM carecore_vital_measurements
        WHERE resident_id = ANY(${residentIds}::uuid[]) AND metric = 'Gewicht'
          AND measured_at > NOW() - make_interval(days => ${lossDays}::int)
        GROUP BY resident_id HAVING COUNT(*) >= 2`
      : Promise.resolve([]),
    behindDays
      ? ctx.sql`
        SELECT r.id AS resident_id, p.daily_fluid_target_ml AS target,
          ROUND(AVG(COALESCE(t.total, 0)))::int AS average
        FROM carecore_residents r
        CROSS JOIN (SELECT timezone AS tz FROM carecore_organizations WHERE id = ${ctx.actor.organizationId}) org
        JOIN carecore_nutrition_plans p ON p.resident_id = r.id AND p.active AND p.daily_fluid_target_ml IS NOT NULL
        CROSS JOIN generate_series(${date}::date - ${behindDays}::int, ${date}::date - 1, INTERVAL '1 day') AS d(day)
        LEFT JOIN LATERAL (
          SELECT SUM(amount_ml) AS total FROM carecore_fluid_entries
          WHERE resident_id = r.id AND deleted_at IS NULL AND (consumed_at AT TIME ZONE org.tz)::date = d.day::date) t ON TRUE
        WHERE r.id = ANY(${residentIds}::uuid[]) AND r.organization_id = ${ctx.actor.organizationId}
          AND (SELECT (MIN(started_at) AT TIME ZONE org.tz)::date FROM carecore_resident_stays WHERE resident_id = r.id)
            <= ${date}::date - ${behindDays}::int
        GROUP BY r.id, p.daily_fluid_target_ml
        HAVING COUNT(*) FILTER (WHERE COALESCE(t.total, 0) < p.daily_fluid_target_ml) = ${behindDays}::int`
      : Promise.resolve([]),
  ])) as [Row[], Row[]];

  for (const row of weights) {
    const first = Number(row.first_kg);
    const latest = Number(row.latest_kg);
    if (!(first > 0)) continue;
    const loss = ((first - latest) / first) * 100;
    if (loss >= Number(lossPercent))
      add(String(row.resident_id), {
        kind: "weight",
        text: `Gewichtsverlust ${kg(first - latest)} (${loss.toLocaleString("de-CH", { maximumFractionDigits: 1 })} %) in ${lossDays} Tagen – Grenze ${lossPercent} %`,
      });
  }
  for (const row of fluids)
    add(String(row.resident_id), {
      kind: "fluid",
      text: `Trinkziel ${behindDays === 1 ? "am Vortag" : `an ${behindDays} Tagen in Folge`} nicht erreicht – Ø ${formatMl(Number(row.average))} von ${formatMl(Number(row.target))}`,
    });
  return trends;
}
