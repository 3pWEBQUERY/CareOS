import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { serviceReport } from "@/lib/services";

export const runtime = "nodejs";

// Monatsauswertung der Leistungen je Person, optional für einen Wohnbereich.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("insights.read");
    if (ctx instanceof NextResponse) return ctx;
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await serviceReport(ctx, params.get("month"), params.get("careUnitId") || null));
  } catch (error) {
    return apiErrorResponse(error, "Leistungsauswertung konnte nicht erstellt werden.");
  }
}
