import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { carecoreActor, carecoreDb, forbidden, hasPermission } from "@/lib/server-data";
import { auditOrigin } from "@/lib/audit-origin";
import { NOT_ASSESSED, careLevelError, countryCode, isCareLevel } from "@/lib/country";
import { residentAudit } from "@/lib/resident-audit";
import { parsePhotoDataUrl } from "@/lib/resident-photo";
import { removeMedia, storeMedia } from "@/lib/storage";

export const runtime = "nodejs";

export async function GET() {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    if (!hasPermission(actor, "residents.read")) return forbidden();
    if (!actor.organizationId) return NextResponse.json({ residents: [], units: [] });
    const sql = carecoreDb();
    const [rows, units, profile] = await Promise.all([
      sql`SELECT r.id, r.first_name, r.last_name, r.gender, r.status, r.admitted_on, r.notes, r.photo_updated_at, (r.photo_updated_at IS NOT NULL) AS has_photo,
          COALESCE(su.name, '') AS care_unit, COALESCE(ro.name, '') AS room,
          COALESCE(cp.care_level, '') AS care_level,
          COALESCE(flag.severity, 'stable') AS severity,
          COALESCE(flag.label, r.notes, 'Keine aktuellen Hinweise') AS note,
          COALESCE(flag.created_at, r.updated_at) AS last_update
        FROM carecore_residents r
        LEFT JOIN LATERAL (SELECT care_unit_id, room_id FROM carecore_resident_stays WHERE resident_id = r.id AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1) stay ON TRUE
        LEFT JOIN carecore_care_units su ON su.id = stay.care_unit_id
        LEFT JOIN carecore_rooms ro ON ro.id = stay.room_id
        LEFT JOIN LATERAL (SELECT care_level FROM carecore_care_plans WHERE resident_id = r.id AND status = 'active' ORDER BY updated_at DESC LIMIT 1) cp ON TRUE
        LEFT JOIN LATERAL (SELECT label, severity, created_at FROM carecore_resident_clinical_flags WHERE resident_id = r.id AND active = TRUE ORDER BY created_at DESC LIMIT 1) flag ON TRUE
        WHERE r.organization_id = ${actor.organizationId}
        -- Laufende Aufenthalte vor ausgetretenen und verstorbenen Personen; darin die eigene Wohngruppe
        -- (Stammwohnbereich) zuerst. Ohne Stammwohnbereich gilt keine Wohngruppe als eigene.
        ORDER BY (r.status IN ('discharged', 'deceased', 'archived')),
          COALESCE(stay.care_unit_id = (SELECT primary_care_unit_id FROM carecore_user_profiles WHERE user_id = ${actor.id}), FALSE) DESC,
          su.name NULLS LAST, r.last_name, r.first_name`,
      sql`SELECT cu.id, cu.name FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id WHERE s.organization_id = ${actor.organizationId} AND cu.active = TRUE ORDER BY cu.name`,
      sql`SELECT cu.name FROM carecore_user_profiles p LEFT JOIN carecore_care_units cu ON cu.id = p.primary_care_unit_id WHERE p.user_id = ${actor.id} LIMIT 1`,
    ]);
    return NextResponse.json({ residents: rows, units, primaryCareUnitName: profile[0]?.name ?? null });
  } catch (error) {
    console.error("Residents GET failed", error);
    return NextResponse.json({ error: "Liste konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const actor = await carecoreActor();
    if (!actor) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    if (!hasPermission(actor, "residents.write")) return forbidden();
    if (!actor.organizationId) return NextResponse.json({ error: "Keine Organisation zugeordnet." }, { status: 400 });
    const body = (await request.json()) as Record<string, unknown>;
    const value = (key: string, limit: number) =>
      typeof body[key] === "string" ? (body[key] as string).trim().slice(0, limit) : "";
    const firstName = value("firstName", 100);
    const lastName = value("lastName", 100);
    const unitName = value("unit", 160);
    // Zimmer aus der Liste des Wohnbereichs (legt die Administration unter Belegung an); per Name nur für Schnittstellen.
    const roomIdInput = value("roomId", 40);
    const roomName = value("room", 80);
    const birthDate = value("birthDate", 10);
    const admissionDate = value("admissionDate", 10);
    const careLevel = value("careLevel", 80);
    const note = value("note", 2000);
    const gender =
      (
        { Weiblich: "female", Männlich: "male", Divers: "diverse", "Keine Angabe": "unspecified" } as Record<
          string,
          string
        >
      )[value("gender", 40)] ?? "unspecified";
    const unitIdInput = value("careUnitId", 40);
    const nurseIdInput = value("primaryNurseId", 40);
    const status =
      ({ Aktiv: "active", "Eintritt geplant": "planned", Vorläufig: "planned" } as Record<string, string>)[
        value("status", 40)
      ] ?? "active";
    if (
      !firstName ||
      !lastName ||
      (!unitIdInput && !unitName) ||
      (!roomIdInput && !roomName) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(birthDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(admissionDate)
    )
      return NextResponse.json({ error: "Bitte alle Pflichtfelder vollständig ausfüllen." }, { status: 400 });
    if (birthDate > admissionDate)
      return NextResponse.json({ error: "Das Geburtsdatum liegt nach dem Eintritt." }, { status: 400 });
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (
      (unitIdInput && !uuid.test(unitIdInput)) ||
      (nurseIdInput && !uuid.test(nurseIdInput)) ||
      (roomIdInput && !uuid.test(roomIdInput))
    )
      return NextResponse.json({ error: "Wohnbereich, Zimmer oder Bezugspflege ist ungültig." }, { status: 400 });
    // Optional: Bild der Person direkt bei der Aufnahme (gleiche Prüfung wie in der Akte).
    const photo = body.photoDataUrl ? parsePhotoDataUrl(body.photoDataUrl) : null;
    if (photo && !photo.ok) return NextResponse.json({ error: photo.error }, { status: photo.status });
    const sql = carecoreDb();
    const units = unitIdInput
      ? await sql`SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id WHERE s.organization_id = ${actor.organizationId} AND cu.id = ${unitIdInput} AND cu.active = TRUE LIMIT 1`
      : await sql`SELECT cu.id FROM carecore_care_units cu JOIN carecore_sites s ON s.id = cu.site_id WHERE s.organization_id = ${actor.organizationId} AND cu.name = ${unitName} AND cu.active = TRUE LIMIT 1`;
    if (!units[0]) return NextResponse.json({ error: "Wohnbereich nicht gefunden." }, { status: 400 });
    const [organization] = await sql`SELECT country FROM carecore_organizations WHERE id = ${actor.organizationId}`;
    const country = countryCode(organization?.country);
    if (!isCareLevel(country, careLevel)) return NextResponse.json({ error: careLevelError(country) }, { status: 400 });
    const unitId = units[0].id as string;
    // Without a chosen primary nurse the resident has none; the record then asks for one.
    let ownerId: string | null = null;
    if (nurseIdInput) {
      const owners =
        await sql`SELECT u.id FROM carecore_users u JOIN carecore_user_profiles p ON p.user_id = u.id WHERE p.organization_id = ${actor.organizationId} AND u.id = ${nurseIdInput} AND u.active = TRUE AND u.archived_at IS NULL LIMIT 1`;
      if (!owners[0]) return NextResponse.json({ error: "Die Bezugspflege ist nicht aktiv." }, { status: 400 });
      ownerId = String(owners[0].id);
    }
    const rooms = roomIdInput
      ? await sql`
          SELECT ro.id, ro.name, ro.beds,
            (SELECT COUNT(*) FROM carecore_resident_stays st JOIN carecore_residents r ON r.id = st.resident_id
              WHERE st.room_id = ro.id AND st.ended_at IS NULL AND r.status IN ('active', 'planned'))::int AS occupied
          FROM carecore_rooms ro WHERE ro.care_unit_id = ${unitId} AND ro.active AND ro.id = ${roomIdInput} LIMIT 1`
      : await sql`
          SELECT ro.id, ro.name, ro.beds,
            (SELECT COUNT(*) FROM carecore_resident_stays st JOIN carecore_residents r ON r.id = st.resident_id
              WHERE st.room_id = ro.id AND st.ended_at IS NULL AND r.status IN ('active', 'planned'))::int AS occupied
          FROM carecore_rooms ro WHERE ro.care_unit_id = ${unitId} AND ro.active AND ro.name = ${roomName} LIMIT 1`;
    if (!rooms[0])
      return NextResponse.json(
        { error: "Das Zimmer gehört nicht zum Wohnbereich. Zimmer legt die Administration unter „Belegung“ an." },
        { status: 400 },
      );
    if (Number(rooms[0].occupied) >= Number(rooms[0].beds))
      return NextResponse.json({ error: `In ${String(rooms[0].name)} ist kein Bett mehr frei.` }, { status: 409 });
    const residentId = randomUUID();
    const photoKey = photo?.ok
      ? await storeMedia("resident-photos", actor.organizationId, randomUUID(), photo.image, photo.mimeType)
      : null;
    const photoBase64 = photo?.ok && !photoKey ? photo.image.toString("base64") : null;
    try {
      await sql`INSERT INTO carecore_residents (id, organization_id, first_name, last_name, date_of_birth, gender, status, admitted_on, notes, primary_care_user_id, photo_base64, photo_storage_key, photo_mime_type, photo_updated_at) VALUES (${residentId}, ${actor.organizationId}, ${firstName}, ${lastName}, ${birthDate}, ${gender}, ${status}, ${admissionDate}, ${note || null}, ${ownerId}, ${photoBase64}, ${photoKey}, ${photo?.ok ? photo.mimeType : null}, ${photo?.ok ? new Date().toISOString() : null})`;
    } catch (error) {
      await removeMedia([photoKey]);
      throw error;
    }
    await sql`INSERT INTO carecore_resident_stays (id, resident_id, care_unit_id, room_id, started_at, created_by) VALUES (${randomUUID()}, ${residentId}, ${unitId}, ${rooms[0].id}, ${new Date(`${admissionDate}T12:00:00Z`).toISOString()}, ${actor.id})`;
    if (careLevel && careLevel !== NOT_ASSESSED)
      await sql`INSERT INTO carecore_care_plans (id, resident_id, owner_user_id, care_level, focus) VALUES (${randomUUID()}, ${residentId}, ${ownerId}, ${careLevel}, ${note || "Aufnahme und Pflegebedarf prüfen."})`;
    await sql`INSERT INTO carecore_audit_log (id, organization_id, actor_user_id, session_id, user_agent, entity_type, entity_id, action, after_data) VALUES (${randomUUID()}, ${actor.organizationId}, ${actor.id}, ${auditOrigin(actor).sessionId}, ${auditOrigin(actor).userAgent}, 'resident', ${residentId}, 'admitted', ${JSON.stringify({ name: `${firstName} ${lastName}`, careUnitId: unitId, room: String(rooms[0].name), primaryNurseId: ownerId })}::jsonb)`;
    if (photo?.ok)
      await residentAudit(sql, actor, {
        residentId,
        entityType: "resident_photo",
        entityId: residentId,
        action: "updated",
        after: { mimeType: photo.mimeType, bytes: photo.image.length },
      });
    return NextResponse.json({ id: residentId }, { status: 201 });
  } catch (error) {
    console.error("Residents POST failed", error);
    return NextResponse.json({ error: "Aufnahme konnte nicht gespeichert werden." }, { status: 500 });
  }
}
