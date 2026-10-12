import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hygieneOverview } from "@/lib/hygiene";

export const runtime = "nodejs";

// Isolationen und Ausbrüche, optional für einen Wohnbereich.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const careUnitId = new URL(request.url).searchParams.get("careUnitId");
    return NextResponse.json(await hygieneOverview(ctx, careUnitId || null));
  } catch (error) {
    return apiErrorResponse(error, "Isolationsübersicht konnte nicht geladen werden.");
  }
}
