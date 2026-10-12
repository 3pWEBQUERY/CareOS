import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { visitOverview } from "@/lib/visits";

export const runtime = "nodejs";

// Offene Einträge „Für Visite“ je Hausärztin bzw. Hausarzt, optional für einen Wohnbereich.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const careUnitId = new URL(request.url).searchParams.get("careUnitId");
    return NextResponse.json(await visitOverview(ctx, careUnitId || null));
  } catch (error) {
    return apiErrorResponse(error, "Visite konnte nicht geladen werden.");
  }
}
