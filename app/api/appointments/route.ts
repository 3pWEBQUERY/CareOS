import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { carecoreActor, carecoreDb, forbidden, hasPermission } from "@/lib/server-data";
import { parseAppointmentInput } from "@/lib/server-appointments";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId)
      return NextResponse.json({ error: "Nicht angemeldet oder keiner Organisation zugeordnet." }, { status: 401 });
    if (!hasPermission(actor, "residents.read")) return forbidden();
    const params = new URL(request.url).searchParams;
    const residentId = params.get("residentId");
    const from = params.get("from");
    const to = params.get("to");
    if (residentId && !/^[0-9a-f-]{36}$/i.test(residentId))
      return NextResponse.json({ error: "Ungültige Auswahl." }, { status: 400 });
    if (
      (from && !Number.isFinite(Date.parse(from))) ||
      (to && !Number.isFinite(Date.parse(to))) ||
      (from && to && Date.parse(to) <= Date.parse(from))
    )
      return NextResponse.json({ error: "Ungültiger Zeitraum." }, { status: 400 });
    const sql = carecoreDb();
    const [appointments, residents, careUnits] = await Promise.all([
      sql`SELECT a.id, a.kind, a.resident_id, CONCAT(r.first_name, ' ', r.last_name) AS resident_name, r.status AS resident_status,
          COALESCE(a.care_unit_id, stay.care_unit_id) AS care_unit_id, cu.name AS care_unit_name, room.name AS room_name,
          a.title, a.category, a.starts_at, a.ends_at, a.location, a.notes, a.status, a.outside, a.transport,
          a.transport_note, a.pickup_at, a.escort, a.documents, a.created_at, a.updated_at
        FROM carecore_resident_appointments a
        LEFT JOIN carecore_residents r ON r.id = a.resident_id AND r.organization_id = a.organization_id
        LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
        LEFT JOIN carecore_care_units cu ON cu.id = COALESCE(a.care_unit_id, stay.care_unit_id)
        LEFT JOIN carecore_rooms room ON room.id = stay.room_id
        WHERE a.organization_id = ${actor.organizationId}
          AND (${residentId}::uuid IS NULL OR a.resident_id = ${residentId}::uuid)
          AND (${from}::timestamptz IS NULL OR a.ends_at > ${from}::timestamptz)
          AND (${to}::timestamptz IS NULL OR a.starts_at < ${to}::timestamptz)
        ORDER BY a.starts_at ASC LIMIT 2000`,
      sql`SELECT r.id, CONCAT(r.first_name, ' ', r.last_name) AS name, r.status,
          stay.care_unit_id, cu.name AS care_unit_name, room.name AS room_name
        FROM carecore_residents r
        LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
        LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
        LEFT JOIN carecore_rooms room ON room.id = stay.room_id
        WHERE r.organization_id = ${actor.organizationId} AND r.status IN ('active', 'planned')
        ORDER BY cu.name NULLS LAST, r.last_name, r.first_name`,
      sql`SELECT cu.id, cu.name, cu.floor FROM carecore_care_units cu
        JOIN carecore_sites s ON s.id = cu.site_id
        WHERE s.organization_id = ${actor.organizationId} AND cu.active = TRUE
        ORDER BY cu.name`,
    ]);
    return NextResponse.json({ appointments, residents, careUnits });
  } catch (error) {
    console.error("Appointments GET failed", error);
    return NextResponse.json({ error: "Termine konnten nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId)
      return NextResponse.json({ error: "Nicht angemeldet oder keiner Organisation zugeordnet." }, { status: 401 });
    if (!hasPermission(actor, "residents.write")) return forbidden();
    const parsed = parseAppointmentInput((await request.json()) as Record<string, unknown>);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const sql = carecoreDb();
    if (parsed.kind === "resident") {
      const resident =
        await sql`SELECT id FROM carecore_residents WHERE id = ${parsed.residentId} AND organization_id = ${actor.organizationId} AND status IN ('active', 'planned') LIMIT 1`;
      if (!resident[0])
        return NextResponse.json({ error: "Akte nicht gefunden oder nicht mehr aktiv." }, { status: 404 });
    } else {
      const careUnit =
        await sql`SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id WHERE cu.id = ${parsed.careUnitId} AND s.organization_id = ${actor.organizationId} AND cu.active = TRUE LIMIT 1`;
      if (!careUnit[0])
        return NextResponse.json({ error: "Wohnbereich nicht gefunden oder nicht mehr aktiv." }, { status: 404 });
    }
    const id = randomUUID();
    await sql`INSERT INTO carecore_resident_appointments (id, organization_id, kind, resident_id, care_unit_id, title, category, starts_at, ends_at, location, notes, status, outside, transport, transport_note, pickup_at, escort, documents, created_by, updated_by)
      VALUES (${id}, ${actor.organizationId}, ${parsed.kind}, ${parsed.residentId}, ${parsed.careUnitId}, ${parsed.title}, ${parsed.category}, ${parsed.startsAt}, ${parsed.endsAt}, ${parsed.location || null}, ${parsed.notes || null}, ${parsed.status}, ${parsed.outside}, ${parsed.transport}, ${parsed.transportNote}, ${parsed.pickupAt}, ${parsed.escort}, ${parsed.documents}, ${actor.id}, ${actor.id})`;
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    console.error("Appointments POST failed", error);
    return NextResponse.json({ error: "Termin konnte nicht erstellt werden." }, { status: 500 });
  }
}
