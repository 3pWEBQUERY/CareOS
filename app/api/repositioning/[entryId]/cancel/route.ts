import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { cancelRepositioningEntry } from "@/lib/repositioning";

export const runtime = "nodejs";
type Context = { params: Promise<{ entryId: string }> };

// { reason } – Positionswechsel stornieren (bleibt sichtbar).
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    await cancelRepositioningEntry(ctx, (await params).entryId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Eintrag konnte nicht storniert werden.");
  }
}
