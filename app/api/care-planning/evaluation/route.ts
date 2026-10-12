import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { evaluationStats } from "@/lib/care-plan-stats";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await evaluationStats(ctx, new URL(request.url).searchParams.get("days")));
  } catch (error) {
    return apiErrorResponse(error, "Auswertung konnte nicht geladen werden.");
  }
}
