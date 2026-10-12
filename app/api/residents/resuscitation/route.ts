import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse, type Row } from "@/lib/api-context";

export const runtime = "nodejs";

// Reanimationsstatus aller Personen der Einrichtung, damit jede Karte mit einer Person ihn sofort zeigt.
export async function GET() {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const rows = (await ctx.sql`
      SELECT id, resuscitation_status FROM carecore_residents
      WHERE organization_id = ${ctx.actor.organizationId}`) as Row[];
    return NextResponse.json({
      statuses: Object.fromEntries(
        rows.map((row) => [
          String(row.id),
          row.resuscitation_status === "full" || row.resuscitation_status === "dnr" ? row.resuscitation_status : null,
        ]),
      ),
    });
  } catch (error) {
    return apiErrorResponse(error, "Reanimationsstatus konnte nicht geladen werden.");
  }
}
