import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { residentAudit } from "@/lib/resident-audit";
import { carecoreActor, carecoreDb, forbidden, hasPermission } from "@/lib/server-data";

export const runtime = "nodejs";

const kinds = ["wound", "redness", "fracture", "other"];

async function access(residentId: string) {
  const actor = await carecoreActor();
  if (!actor?.organizationId) return null;
  const sql = carecoreDb();
  const rows =
    await sql`SELECT id FROM carecore_residents WHERE id = ${residentId} AND organization_id = ${actor.organizationId} LIMIT 1`;
  return rows[0] ? { actor, sql } : null;
}

export async function GET(_request: Request, context: { params: Promise<{ residentId: string }> }) {
  try {
    const { residentId } = await context.params;
    const allowed = await access(residentId);
    if (!allowed) return NextResponse.json({ error: "Akte nicht verfügbar." }, { status: 404 });
    if (!hasPermission(allowed.actor, "residents.read")) return forbidden();
    const observations =
      await allowed.sql`SELECT o.id, o.kind, o.label, o.location, o.status, o.notes, o.body_x, o.body_y, o.body_z, o.created_at, o.updated_at, o.wound_id, COALESCE(u.display_name, 'Mitarbeitende') AS author FROM carecore_body_observations o LEFT JOIN carecore_users u ON u.id = o.created_by WHERE o.resident_id = ${residentId} AND o.archived_at IS NULL ORDER BY o.created_at DESC`;
    return NextResponse.json({ observations });
  } catch (error) {
    console.error("Body observations GET failed", error);
    return NextResponse.json({ error: "Körperstatus konnte nicht geladen werden." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ residentId: string }> }) {
  try {
    const { residentId } = await context.params;
    const allowed = await access(residentId);
    if (!allowed) return NextResponse.json({ error: "Akte nicht verfügbar." }, { status: 404 });
    if (!hasPermission(allowed.actor, "documentation.write")) return forbidden();
    const input = (await request.json()) as Record<string, unknown>;
    const kind = typeof input.kind === "string" ? input.kind : "";
    const label = typeof input.label === "string" ? input.label.trim() : "";
    const location = typeof input.location === "string" ? input.location.trim() : "";
    const status = typeof input.status === "string" ? input.status.trim() : "";
    const notes = typeof input.notes === "string" ? input.notes.trim() : "";
    const x = Number(input.x),
      y = Number(input.y),
      z = Number(input.z);
    if (
      !kinds.includes(kind) ||
      !label ||
      label.length > 120 ||
      !location ||
      location.length > 160 ||
      status.length > 120 ||
      notes.length > 4000 ||
      ![x, y, z].every((value) => Number.isFinite(value) && Math.abs(value) <= 3)
    )
      return NextResponse.json({ error: "Bitte Befund und Körperstelle vollständig angeben." }, { status: 400 });
    const id = randomUUID();
    const [rows] = await allowed.sql.transaction([
      allowed.sql`INSERT INTO carecore_body_observations (id, resident_id, kind, label, location, status, notes, body_x, body_y, body_z, created_by, updated_by) VALUES (${id}, ${residentId}, ${kind}, ${label}, ${location}, ${status || "Beobachten"}, ${notes}, ${x}, ${y}, ${z}, ${allowed.actor.id}, ${allowed.actor.id}) RETURNING id, kind, label, location, status, notes, body_x, body_y, body_z, created_at, updated_at`,
      residentAudit(allowed.sql, allowed.actor, {
        residentId,
        entityType: "body_observation",
        entityId: id,
        action: "created",
        after: { kind, label, location, status: status || "Beobachten", notes },
      }),
    ]);
    return NextResponse.json({ observation: { ...rows[0], author: allowed.actor.display_name } }, { status: 201 });
  } catch (error) {
    console.error("Body observations POST failed", error);
    return NextResponse.json({ error: "Befund konnte nicht gespeichert werden." }, { status: 500 });
  }
}
