import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { cancelEliminationEntry } from "@/lib/elimination";

export const runtime = "nodejs";
type Context = { params: Promise<{ entryId: string }> };

// { reason } – Eintrag stornieren (bleibt sichtbar).
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    await cancelEliminationEntry(ctx, (await params).entryId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Eintrag konnte nicht storniert werden.");
  }
}
