import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { staffOf } from "@/lib/care-planning";
import { careRecordsOverview } from "@/lib/care-records";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const [records, staff] = await Promise.all([careRecordsOverview(ctx), staffOf(ctx)]);
    return NextResponse.json({ records, staff, canWrite: hasPermission(ctx.actor, "documentation.write") });
  } catch (error) {
    return apiErrorResponse(error, "Pflegeakten konnten nicht geladen werden.");
  }
}
