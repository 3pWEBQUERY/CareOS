import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";

export const runtime = "nodejs";

// Choices of the admission form: active care units with their rooms and the active staff.
export async function GET() {
  try {
    const ctx = await apiContext("residents.write");
    if (ctx instanceof NextResponse) return ctx;
    const org = ctx.actor.organizationId;
    const [units, rooms, staff, profile] = await Promise.all([
      ctx.sql`
        SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id
        WHERE s.organization_id = ${org} AND cu.active ORDER BY cu.name`,
      ctx.sql`
        SELECT ro.id, ro.name, ro.care_unit_id, ro.beds,
          (SELECT COUNT(*) FROM carecore_resident_stays st JOIN carecore_residents r ON r.id = st.resident_id
            WHERE st.room_id = ro.id AND st.ended_at IS NULL AND r.status IN ('active', 'planned'))::int AS occupied
        FROM carecore_rooms ro JOIN carecore_care_units cu ON cu.id = ro.care_unit_id JOIN carecore_sites s ON s.id = cu.site_id
        WHERE s.organization_id = ${org} AND ro.active ORDER BY ro.name`,
      ctx.sql`
        SELECT u.id, u.display_name FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id
        WHERE p.organization_id = ${org} AND u.active AND u.archived_at IS NULL ORDER BY u.display_name`,
      ctx.sql`SELECT primary_care_unit_id FROM carecore_user_profiles WHERE user_id = ${ctx.actor.id}`,
    ]);
    return NextResponse.json({
      units: units.map((row) => ({ id: String(row.id), name: String(row.name) })),
      rooms: rooms.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        careUnitId: String(row.care_unit_id),
        free: Math.max(0, Number(row.beds) - Number(row.occupied)),
      })),
      staff: staff.map((row) => ({ id: String(row.id), name: String(row.display_name) })),
      primaryCareUnitId: profile[0]?.primary_care_unit_id ? String(profile[0].primary_care_unit_id) : null,
    });
  } catch (error) {
    return apiErrorResponse(error, "Angaben für die Aufnahme konnten nicht geladen werden.");
  }
}
