import { ApiError, assertUuid, iso, type ApiContext, type Row } from "@/lib/api-context";
import { residentAudit } from "@/lib/resident-audit";
import { hasPermission } from "@/lib/server-data";
import type { AppointmentStatus, AppointmentTransport } from "@/lib/resident-appointments";
import { OUTING_EVENTS, type Outing, type OutingDay } from "@/lib/outings-shared";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

const stamp = (at: unknown, by: unknown) => (at ? { at: iso(at) ?? "", by: (by as string | null) ?? null } : null);

// Termine ausser Haus eines Tages (Ortszeit der Einrichtung), nach Abholung bzw. Beginn sortiert.
export async function outingDay(ctx: ApiContext, dateInput: unknown): Promise<OutingDay> {
  if (!hasPermission(ctx.actor, "residents.read")) throw new ApiError("Keine Berechtigung.", 403);
  const org = ctx.actor.organizationId;
  const [orgRow] = (await ctx.sql`
    SELECT name, timezone, to_char(NOW() AT TIME ZONE timezone, 'YYYY-MM-DD') AS today
    FROM carecore_organizations WHERE id = ${org}`) as Row[];
  const today = String(orgRow.today);
  if (
    dateInput !== null &&
    dateInput !== undefined &&
    dateInput !== "" &&
    !(typeof dateInput === "string" && DATE.test(dateInput))
  )
    throw new ApiError("Das Datum ist ungültig.");
  const date = typeof dateInput === "string" && DATE.test(dateInput) ? dateInput : today;
  const timezone = String(orgRow.timezone);
  const rows = (await ctx.sql`
    SELECT a.*, r.last_name || ' ' || r.first_name AS resident_name, COALESCE(room.name, '') AS room,
      COALESCE(cu.name, '') AS care_unit, d.display_name AS departed_name, b.display_name AS returned_name
    FROM carecore_resident_appointments a
    JOIN carecore_residents r ON r.id = a.resident_id
    LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays
      WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
    LEFT JOIN carecore_rooms room ON room.id = stay.room_id
    LEFT JOIN carecore_care_units cu ON cu.id = stay.care_unit_id
    LEFT JOIN carecore_users d ON d.id = a.departed_by
    LEFT JOIN carecore_users b ON b.id = a.returned_by
    WHERE a.organization_id = ${org} AND a.outside
      AND (a.starts_at AT TIME ZONE ${timezone})::date = ${date}::date
    ORDER BY COALESCE(a.pickup_at, a.starts_at), a.starts_at, r.last_name`) as Row[];
  return {
    date,
    today,
    organization: String(orgRow.name),
    canWrite: hasPermission(ctx.actor, "residents.write"),
    outings: rows.map((row): Outing => ({
      id: String(row.id),
      residentId: String(row.resident_id),
      residentName: String(row.resident_name),
      room: String(row.room),
      careUnit: String(row.care_unit),
      title: String(row.title),
      category: String(row.category),
      location: String(row.location ?? ""),
      startsAt: iso(row.starts_at) ?? "",
      endsAt: iso(row.ends_at) ?? "",
      status: row.status as AppointmentStatus,
      transport: (row.transport as AppointmentTransport | null) ?? null,
      transportNote: String(row.transport_note),
      pickupAt: iso(row.pickup_at),
      escort: String(row.escort),
      documents: String(row.documents),
      notes: String(row.notes ?? ""),
      departed: stamp(row.departed_at, row.departed_name),
      returned: stamp(row.returned_at, row.returned_name),
    })),
  };
}

// Abfahrt bzw. Rückkehr vermerken ({ event: "departed" | "returned" | "undo" }); „undo“ nimmt den letzten Vermerk
// zurück.
export async function markOuting(ctx: ApiContext, idInput: unknown, body: Record<string, unknown>) {
  if (!hasPermission(ctx.actor, "residents.write")) throw new ApiError("Keine Berechtigung.", 403);
  const id = assertUuid(idInput, "Termin");
  const event = String(body.event ?? "");
  if (!(event in OUTING_EVENTS)) throw new ApiError("Ungültige Angabe.");
  const [row] = (await ctx.sql`
    SELECT id, resident_id, title, status, departed_at, returned_at, departed_at::text AS departed_stamp,
      returned_at::text AS returned_stamp FROM carecore_resident_appointments
    WHERE id = ${id} AND organization_id = ${ctx.actor.organizationId} AND outside`) as Row[];
  if (!row) throw new ApiError("Termin nicht gefunden.", 404);
  if (event !== "undo" && row.status === "cancelled") throw new ApiError("Der Termin ist abgesagt.", 409);
  if (event === "departed" && row.departed_at) throw new ApiError("Die Abfahrt ist bereits vermerkt.", 409);
  if (event === "returned" && !row.departed_at) throw new ApiError("Bitte zuerst die Abfahrt vermerken.", 409);
  if (event === "returned" && row.returned_at) throw new ApiError("Die Rückkehr ist bereits vermerkt.", 409);
  if (event === "undo" && !row.departed_at) throw new ApiError("Es gibt nichts zurückzunehmen.", 409);
  const undoReturn = event === "undo" && Boolean(row.returned_at);
  const action = event === "undo" ? (undoReturn ? "return_undone" : "departure_undone") : event;
  await ctx.sql
    .transaction([
      ctx.sql`
        WITH changed AS (
          UPDATE carecore_resident_appointments SET
            departed_at = CASE WHEN ${event} = 'departed' THEN NOW()
              WHEN ${event} = 'undo' AND NOT ${undoReturn} THEN NULL ELSE departed_at END,
            departed_by = CASE WHEN ${event} = 'departed' THEN ${ctx.actor.id}::uuid
              WHEN ${event} = 'undo' AND NOT ${undoReturn} THEN NULL ELSE departed_by END,
            returned_at = CASE WHEN ${event} = 'returned' THEN GREATEST(NOW(), departed_at)
              WHEN ${event} = 'undo' THEN NULL ELSE returned_at END,
            returned_by = CASE WHEN ${event} = 'returned' THEN ${ctx.actor.id}::uuid
              WHEN ${event} = 'undo' THEN NULL ELSE returned_by END,
            updated_by = ${ctx.actor.id}, updated_at = NOW()
          WHERE id = ${id}
            AND departed_at::text IS NOT DISTINCT FROM ${(row.departed_stamp as string | null) ?? null}
            AND returned_at::text IS NOT DISTINCT FROM ${(row.returned_stamp as string | null) ?? null}
          RETURNING id)
        SELECT carecore_assert(EXISTS (SELECT 1 FROM changed), 'OUTING_CHANGED')`,
      residentAudit(ctx.sql, ctx.actor, {
        residentId: String(row.resident_id),
        entityType: "resident_appointment",
        entityId: id,
        action,
        after: { title: row.title },
      }),
    ])
    .catch((error) => {
      if (String(error).includes("OUTING_CHANGED"))
        throw new ApiError("Der Termin wurde inzwischen geändert. Bitte neu laden.", 409);
      throw error;
    });
}
