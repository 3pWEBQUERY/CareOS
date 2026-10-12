import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { occupancyOverview } from "@/lib/occupancy";

export const runtime = "nodejs";

// Belegung je Wohnbereich, geplante Eintritte und Warteliste.
export async function GET() {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await occupancyOverview(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Belegung konnte nicht geladen werden.");
  }
}
