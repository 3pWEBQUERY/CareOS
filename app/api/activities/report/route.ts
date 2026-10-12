import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { activityReport } from "@/lib/activities";

export const runtime = "nodejs";

// Teilnahme je Person im Monat, optional für einen Wohnbereich.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await activityReport(ctx, params.get("month"), params.get("careUnitId") || null));
  } catch (error) {
    return apiErrorResponse(error, "Übersicht konnte nicht erstellt werden.");
  }
}
