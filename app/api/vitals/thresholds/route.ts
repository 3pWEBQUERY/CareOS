import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { forbidden, hasPermission } from "@/lib/server-data";
import { listThresholds, saveThreshold } from "@/lib/vitals";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await listThresholds(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Grenzwerte konnten nicht geladen werden.");
  }
}

// House-wide thresholds need quality.manage, personal target ranges documentation.write.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    if (!hasPermission(ctx.actor, body.residentId ? "documentation.write" : "quality.manage")) return forbidden();
    return NextResponse.json({ id: await saveThreshold(ctx, body) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Grenzwert konnte nicht gespeichert werden.");
  }
}
