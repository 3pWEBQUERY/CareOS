import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { historyOverview } from "@/lib/resident-history";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({
      ...(await historyOverview(ctx)),
      canWrite: hasPermission(ctx.actor, "residents.write"),
    });
  } catch (error) {
    return apiErrorResponse(error, "Verlauf konnte nicht geladen werden.");
  }
}
