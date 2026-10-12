import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { dailyWorklist } from "@/lib/worklist";

export const runtime = "nodejs";

// Today's worklist per resident; ?careUnitId= limits it to one care unit.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await dailyWorklist(ctx, new URL(request.url).searchParams.get("careUnitId")));
  } catch (error) {
    return apiErrorResponse(error, "Tagesliste konnte nicht geladen werden.");
  }
}
