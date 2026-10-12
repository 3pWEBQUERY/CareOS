import { NextResponse } from "next/server";
import { isRepresentativeRole } from "@/lib/advance-care-shared";
import { residentAudit } from "@/lib/resident-audit";
import { carecoreActor, carecoreDb, forbidden, hasPermission } from "@/lib/server-data";

export const runtime = "nodejs";

type ContactInput = {
  fullName?: unknown;
  relationship?: unknown;
  phone?: unknown;
  email?: unknown;
  isPrimary?: unknown;
  isEmergencyContact?: unknown;
  representativeRole?: unknown;
};

async function contactContext(residentId: string, contactId: string) {
  const actor = await carecoreActor();
  if (!actor?.organizationId) return null;
  const sql = carecoreDb();
  const rows =
    await sql`SELECT c.id FROM carecore_resident_contacts c INNER JOIN carecore_residents r ON r.id = c.resident_id WHERE c.id = ${contactId} AND c.resident_id = ${residentId} AND r.organization_id = ${actor.organizationId} LIMIT 1`;
  return rows[0] ? { actor, sql } : null;
}

function contactValues(input: ContactInput) {
  const value = (key: keyof ContactInput, limit: number) =>
    typeof input[key] === "string" ? input[key].trim().slice(0, limit) : "";
  return {
    fullName: value("fullName", 160),
    relationship: value("relationship", 100),
    phone: value("phone", 60),
    email: value("email", 160),
    isPrimary: input.isPrimary === true,
    isEmergencyContact: input.isEmergencyContact === true,
    // Rolle als vertretungsberechtigte Person (z. B. Vorsorgeauftrag), sonst null.
    representativeRole: isRepresentativeRole(input.representativeRole) ? input.representativeRole : null,
  };
}

async function contactSnapshot(sql: ReturnType<typeof carecoreDb>, contactId: string) {
  const rows =
    await sql`SELECT full_name, relationship, phone, email, is_primary, is_emergency_contact, representative_role FROM carecore_resident_contacts WHERE id = ${contactId}`;
  const row = rows[0];
  return row
    ? {
        fullName: row.full_name,
        relationship: row.relationship,
        phone: row.phone,
        email: row.email,
        isPrimary: row.is_primary,
        isEmergencyContact: row.is_emergency_contact,
        representativeRole: row.representative_role,
      }
    : null;
}

export async function PATCH(request: Request, context: { params: Promise<{ residentId: string; contactId: string }> }) {
  try {
    const { residentId, contactId } = await context.params;
    const active = await contactContext(residentId, contactId);
    if (!active) return NextResponse.json({ error: "Kontaktperson nicht verfügbar." }, { status: 404 });
    if (!hasPermission(active.actor, "residents.write")) return forbidden();
    const input = contactValues((await request.json()) as ContactInput);
    if (!input.fullName) return NextResponse.json({ error: "Bitte gib einen Namen an." }, { status: 400 });
    const before = await contactSnapshot(active.sql, contactId);
    const results = await active.sql.transaction([
      active.sql`UPDATE carecore_resident_contacts SET is_primary = FALSE, updated_at = NOW() WHERE resident_id = ${residentId} AND id <> ${contactId} AND ${input.isPrimary}`,
      active.sql`UPDATE carecore_resident_contacts SET full_name = ${input.fullName}, relationship = ${input.relationship || null}, phone = ${input.phone || null}, email = ${input.email || null}, is_primary = ${input.isPrimary}, is_emergency_contact = ${input.isEmergencyContact}, representative_role = ${input.representativeRole}, updated_at = NOW() WHERE id = ${contactId} RETURNING id, full_name, relationship, phone, email, is_primary, is_emergency_contact, representative_role, updated_at`,
      residentAudit(active.sql, active.actor, {
        residentId,
        entityType: "resident_contact",
        entityId: contactId,
        action: "updated",
        before,
        after: input,
      }),
    ]);
    return NextResponse.json({ contact: results[1][0] });
  } catch (error) {
    console.error("Contacts PATCH failed", error);
    return NextResponse.json({ error: "Kontaktperson konnte nicht aktualisiert werden." }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ residentId: string; contactId: string }> },
) {
  try {
    const { residentId, contactId } = await context.params;
    const active = await contactContext(residentId, contactId);
    if (!active) return NextResponse.json({ error: "Kontaktperson nicht verfügbar." }, { status: 404 });
    if (!hasPermission(active.actor, "residents.write")) return forbidden();
    const before = await contactSnapshot(active.sql, contactId);
    await active.sql.transaction([
      active.sql`DELETE FROM carecore_resident_contacts WHERE id = ${contactId}`,
      residentAudit(active.sql, active.actor, {
        residentId,
        entityType: "resident_contact",
        entityId: contactId,
        action: "deleted",
        before,
      }),
    ]);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Contacts DELETE failed", error);
    return NextResponse.json({ error: "Kontaktperson konnte nicht gelöscht werden." }, { status: 500 });
  }
}
