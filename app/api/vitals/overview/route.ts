import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { vitalsOverview } from "@/lib/vitals";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({
      ...(await vitalsOverview(ctx)),
      canRecord: hasPermission(ctx.actor, "documentation.write"),
      canManageHouse: hasPermission(ctx.actor, "quality.manage"),
      canManagePersonal: hasPermission(ctx.actor, "documentation.write"),
    });
  } catch (error) {
    return apiErrorResponse(error, "Vitalwerte konnten nicht geladen werden.");
  }
}
