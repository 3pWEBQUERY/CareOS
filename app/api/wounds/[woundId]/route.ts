import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { setWoundStatus, updateWound } from "@/lib/wounds";

export const runtime = "nodejs";
type Context = { params: Promise<{ woundId: string }> };

// With `status` the wound is closed, reopened or marked as healing; otherwise its data is updated.
export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { woundId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    if ("status" in body) await setWoundStatus(ctx, woundId, body.status, body.reason);
    else await updateWound(ctx, woundId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Wunde konnte nicht aktualisiert werden.");
  }
}
