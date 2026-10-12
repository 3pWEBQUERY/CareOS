import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse, text } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { removeThreshold } from "@/lib/vitals";

export const runtime = "nodejs";
type Context = { params: Promise<{ thresholdId: string }> };

export async function DELETE(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { thresholdId } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
    await removeThreshold(
      ctx,
      thresholdId,
      (scope) => hasPermission(ctx.actor, scope === "resident" ? "documentation.write" : "quality.manage"),
      text(body.reason, 1000),
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Grenzwert konnte nicht entfernt werden.");
  }
}
