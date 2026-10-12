import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { qualityIndicators } from "@/lib/quality-indicators";

export const runtime = "nodejs";

// Medizinische Qualitätsindikatoren (Stichtag heute), optional für einen Wohnbereich.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("insights.read");
    if (ctx instanceof NextResponse) return ctx;
    const careUnitId = new URL(request.url).searchParams.get("careUnitId");
    return NextResponse.json(await qualityIndicators(ctx, careUnitId || null));
  } catch (error) {
    return apiErrorResponse(error, "Qualitätsindikatoren konnten nicht berechnet werden.");
  }
}
