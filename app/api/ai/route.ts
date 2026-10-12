import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { aiOverview } from "@/lib/ai";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const ctx = await apiContext("ai.use");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await aiOverview(ctx, new URL(request.url).searchParams.get("careUnitId")));
  } catch (error) {
    return apiErrorResponse(error, "CareOS KI konnte nicht geladen werden.");
  }
}
