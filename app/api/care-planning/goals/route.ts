import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { listGoals } from "@/lib/care-plan-stats";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({
      goals: await listGoals(ctx),
      currentUserId: ctx.actor.id,
      canWrite: hasPermission(ctx.actor, "documentation.write"),
    });
  } catch (error) {
    return apiErrorResponse(error, "Pflegeziele konnten nicht geladen werden.");
  }
}
