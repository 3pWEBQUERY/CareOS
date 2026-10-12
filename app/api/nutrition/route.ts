import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { nutritionOverview } from "@/lib/nutrition";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({
      ...(await nutritionOverview(ctx, new URL(request.url).searchParams.get("date"))),
      canWrite: hasPermission(ctx.actor, "documentation.write"),
    });
  } catch (error) {
    return apiErrorResponse(error, "Ernährungsdaten konnten nicht geladen werden.");
  }
}
