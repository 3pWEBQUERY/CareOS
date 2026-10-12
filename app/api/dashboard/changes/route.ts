import { NextResponse } from "next/server";
import { carecoreActor, carecoreDb, forbidden, hasPermission } from "@/lib/server-data";

export const runtime = "nodejs";

export async function GET() {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    if (!hasPermission(actor, "residents.read")) return forbidden();
    const sql = carecoreDb();
    const profile = await sql`SELECT p.primary_care_unit_id, cu.name AS care_unit_name
      FROM carecore_user_profiles p LEFT JOIN carecore_care_units cu ON cu.id = p.primary_care_unit_id
      WHERE p.user_id = ${actor.id} AND p.organization_id = ${actor.organizationId} LIMIT 1`;
    const careUnitId = (profile[0]?.primary_care_unit_id as string | null | undefined) ?? null;
    const [changes, residents] = await Promise.all([
      sql`SELECT d.id, d.resident_id, d.title, d.body, d.importance, d.occurred_at,
          r.first_name, r.last_name, cu.name AS care_unit_name
        FROM carecore_documentation_entries d
        JOIN carecore_residents r ON r.id = d.resident_id AND r.organization_id = ${actor.organizationId}
        LEFT JOIN LATERAL (SELECT care_unit_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
        LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
        WHERE r.status = 'active' AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid)
        ORDER BY d.occurred_at DESC LIMIT 80`,
      sql`SELECT r.id, r.first_name, r.last_name, COALESCE(room.name, 'Zimmer offen') AS room,
          cu.name AS care_unit_name, latest.title, latest.body, latest.importance,
          latest.occurred_at, flag.label AS flag_label, flag.severity AS flag_severity
        FROM carecore_residents r
        LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
        LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
        LEFT JOIN carecore_rooms room ON room.id = stay.room_id
        LEFT JOIN LATERAL (SELECT title, body, importance, occurred_at FROM carecore_documentation_entries WHERE resident_id = r.id ORDER BY occurred_at DESC LIMIT 1) latest ON TRUE
        LEFT JOIN LATERAL (SELECT label, severity FROM carecore_resident_clinical_flags WHERE resident_id = r.id AND active = TRUE ORDER BY created_at DESC LIMIT 1) flag ON TRUE
        WHERE r.organization_id = ${actor.organizationId} AND r.status = 'active'
          AND (${careUnitId}::uuid IS NULL OR stay.care_unit_id = ${careUnitId}::uuid)
        ORDER BY latest.occurred_at DESC NULLS LAST, r.last_name, r.first_name LIMIT 200`,
    ]);
    return NextResponse.json({ changes, residents, scope: profile[0]?.care_unit_name ?? "Alle Wohnbereiche" });
  } catch (error) {
    console.error("Dashboard changes GET failed", error);
    return NextResponse.json({ error: "Neuigkeiten konnten nicht geladen werden." }, { status: 500 });
  }
}
