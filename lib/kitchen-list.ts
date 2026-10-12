import { ApiError, iso, type ApiContext, type Row } from "@/lib/api-context";
import type { KitchenList } from "@/lib/kitchen-list-shared";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Küchenliste: alle Personen mit laufendem Aufenthalt (ohne extern verlegte) je Wohnbereich mit den Angaben des aktiven
// Ernährungsplans. Personen ohne Plan erscheinen mit „kein Ernährungsplan“, damit niemand fehlt.
export async function kitchenList(ctx: ApiContext, unitInput: unknown): Promise<KitchenList> {
  const unitId = unitInput === null || unitInput === undefined || unitInput === "" ? null : String(unitInput);
  if (unitId && !UUID.test(unitId)) throw new ApiError("Wohnbereich ist ungültig.");
  const org = ctx.actor.organizationId;
  const [units, people, organization] = (await Promise.all([
    ctx.sql`
      SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
      WHERE s.organization_id = ${org} AND cu.active AND (${unitId}::uuid IS NULL OR cu.id = ${unitId}::uuid)
      ORDER BY cu.name`,
    ctx.sql`
      SELECT r.id, r.last_name || ' ' || r.first_name AS name, COALESCE(ro.name, '') AS room, st.care_unit_id,
        p.diet, p.texture, p.allergies, p.preferences, p.assistance, p.meal_rhythm, p.instructions, p.fluid_limit_ml,
        p.updated_at AS plan_updated_at
      FROM carecore_resident_stays st
      JOIN carecore_residents r ON r.id = st.resident_id
      LEFT JOIN carecore_rooms ro ON ro.id = st.room_id
      LEFT JOIN LATERAL (SELECT * FROM carecore_nutrition_plans n WHERE n.resident_id = r.id AND n.active
        ORDER BY n.updated_at DESC LIMIT 1) p ON TRUE
      WHERE r.organization_id = ${org} AND st.ended_at IS NULL AND r.status = 'active'
      ORDER BY ro.name NULLS LAST, r.last_name, r.first_name`,
    ctx.sql`SELECT name, NOW() AS now FROM carecore_organizations WHERE id = ${org}`,
  ])) as Row[][];
  if (unitId && !units[0]) throw new ApiError("Wohnbereich nicht gefunden.", 404);
  const value = (input: unknown) => (typeof input === "string" ? input.trim() : "");
  return {
    generatedAt: iso(organization[0]?.now) ?? new Date().toISOString(),
    organization: String(organization[0]?.name ?? ""),
    units: units.map((unit) => ({
      id: String(unit.id),
      name: String(unit.name),
      people: people
        .filter((row) => row.care_unit_id === unit.id)
        .map((row) => ({
          id: String(row.id),
          name: String(row.name),
          room: String(row.room),
          diet: value(row.diet),
          texture: value(row.texture),
          allergies: value(row.allergies),
          preferences: value(row.preferences),
          assistance: value(row.assistance),
          mealRhythm: value(row.meal_rhythm),
          instructions: value(row.instructions),
          fluidLimitMl:
            row.fluid_limit_ml === null || row.fluid_limit_ml === undefined ? null : Number(row.fluid_limit_ml),
          planUpdatedAt: iso(row.plan_updated_at),
        })),
    })),
  };
}
