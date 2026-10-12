import { NextResponse } from "next/server";
import { residentAudit } from "@/lib/resident-audit";
import { carecoreActor, carecoreDb, forbidden, hasPermission } from "@/lib/server-data";

export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ residentId: string }> }) {
  try {
    const actor = await carecoreActor();
    if (!actor?.organizationId) return NextResponse.json({ error: "Nicht angemeldet." }, { status: 401 });
    if (!hasPermission(actor, "residents.write")) return forbidden();
    const { residentId } = await context.params;
    const body = (await request.json()) as { gender?: unknown };
    if (typeof body.gender !== "string" || !["male", "female", "diverse", "unspecified"].includes(body.gender))
      return NextResponse.json({ error: "Ungültiges Geschlecht." }, { status: 400 });
    const sql = carecoreDb();
    const current =
      await sql`SELECT gender FROM carecore_residents WHERE id = ${residentId} AND organization_id = ${actor.organizationId}`;
    if (!current[0]) return NextResponse.json({ error: "Akte nicht gefunden." }, { status: 404 });
    const [rows] = await sql.transaction([
      sql`UPDATE carecore_residents SET gender = ${body.gender}, updated_at = NOW() WHERE id = ${residentId} AND organization_id = ${actor.organizationId} RETURNING gender`,
      residentAudit(sql, actor, {
        residentId,
        entityType: "resident",
        entityId: residentId,
        action: "gender_updated",
        before: { gender: current[0].gender },
        after: { gender: body.gender },
      }),
    ]);
    if (!rows[0]) return NextResponse.json({ error: "Akte nicht gefunden." }, { status: 404 });
    return NextResponse.json({ gender: rows[0].gender });
  } catch (error) {
    console.error("Resident PATCH failed", error);
    return NextResponse.json({ error: "Stammdaten konnten nicht gespeichert werden." }, { status: 500 });
  }
}
