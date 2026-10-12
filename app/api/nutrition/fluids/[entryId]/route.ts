import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hideEntry } from "@/lib/nutrition";

export const runtime = "nodejs";
type Context = { params: Promise<{ entryId: string }> };

// Entries are hidden with a reason instead of being deleted.
export async function DELETE(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { entryId } = await params;
    const body = (await request.json().catch(() => ({}))) as { reason?: unknown };
    await hideEntry(ctx, "fluid", entryId, body.reason);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Trinkeintrag konnte nicht korrigiert werden.");
  }
}
