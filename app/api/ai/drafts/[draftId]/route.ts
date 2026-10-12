import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { reviewDraft } from "@/lib/ai";
import { forbidden, hasPermission } from "@/lib/server-data";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ draftId: string }> }) {
  try {
    const ctx = await apiContext("ai.use");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    // Accepting writes to the care record.
    if (body.action === "accept" && !hasPermission(ctx.actor, "documentation.write")) return forbidden();
    return NextResponse.json({ draft: await reviewDraft(ctx, (await params).draftId, body) });
  } catch (error) {
    return apiErrorResponse(error, "KI-Entwurf konnte nicht gespeichert werden.");
  }
}
