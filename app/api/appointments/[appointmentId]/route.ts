import { NextResponse } from "next/server";
import { carecoreActor, carecoreDb, forbidden, hasPermission } from "@/lib/server-data";
import { parseAppointmentInput } from "@/lib/server-appointments";

export const runtime = "nodejs";
type Context = { params: Promise<{ appointmentId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId)
      return NextResponse.json({ error: "Nicht angemeldet oder keiner Organisation zugeordnet." }, { status: 401 });
    if (!hasPermission(actor, "residents.write")) return forbidden();
    const { appointmentId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(appointmentId))
      return NextResponse.json({ error: "Ungültiger Termin." }, { status: 400 });
    const parsed = parseAppointmentInput((await request.json()) as Record<string, unknown>);
    if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const sql = carecoreDb();
    const rows = await sql`UPDATE carecore_resident_appointments a
      SET kind = ${parsed.kind}, resident_id = ${parsed.residentId}, care_unit_id = ${parsed.careUnitId}, title = ${parsed.title}, category = ${parsed.category},
          starts_at = ${parsed.startsAt}, ends_at = ${parsed.endsAt}, location = ${parsed.location || null},
          notes = ${parsed.notes || null}, status = ${parsed.status}, outside = ${parsed.outside},
          transport = ${parsed.transport}, transport_note = ${parsed.transportNote}, pickup_at = ${parsed.pickupAt},
          escort = ${parsed.escort}, documents = ${parsed.documents},
          departed_at = CASE WHEN ${parsed.outside} THEN a.departed_at END,
          departed_by = CASE WHEN ${parsed.outside} THEN a.departed_by END,
          returned_at = CASE WHEN ${parsed.outside} THEN a.returned_at END,
          returned_by = CASE WHEN ${parsed.outside} THEN a.returned_by END, updated_by = ${actor.id}, updated_at = NOW()
      WHERE a.id = ${appointmentId} AND a.organization_id = ${actor.organizationId}
        AND (
          (${parsed.kind} = 'resident' AND EXISTS (SELECT 1 FROM carecore_residents r WHERE r.id = ${parsed.residentId} AND r.organization_id = ${actor.organizationId} AND r.status IN ('active', 'planned')))
          OR (${parsed.kind} = 'care_unit_task' AND EXISTS (SELECT 1 FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id WHERE cu.id = ${parsed.careUnitId} AND s.organization_id = ${actor.organizationId} AND cu.active = TRUE))
        )
      RETURNING a.id`;
    if (!rows[0]) return NextResponse.json({ error: "Termin, Akte oder Wohnbereich nicht gefunden." }, { status: 404 });
    return NextResponse.json({ id: appointmentId });
  } catch (error) {
    console.error("Appointments PATCH failed", error);
    return NextResponse.json({ error: "Termin konnte nicht gespeichert werden." }, { status: 500 });
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId)
      return NextResponse.json({ error: "Nicht angemeldet oder keiner Organisation zugeordnet." }, { status: 401 });
    if (!hasPermission(actor, "residents.write")) return forbidden();
    const { appointmentId } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(appointmentId))
      return NextResponse.json({ error: "Ungültiger Termin." }, { status: 400 });
    const sql = carecoreDb();
    const rows =
      await sql`DELETE FROM carecore_resident_appointments WHERE id = ${appointmentId} AND organization_id = ${actor.organizationId} RETURNING id`;
    if (!rows[0]) return NextResponse.json({ error: "Termin nicht gefunden." }, { status: 404 });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Appointments DELETE failed", error);
    return NextResponse.json({ error: "Termin konnte nicht gelöscht werden." }, { status: 500 });
  }
}
