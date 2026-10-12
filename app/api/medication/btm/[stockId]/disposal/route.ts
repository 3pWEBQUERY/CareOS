import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { disposeStock } from "@/lib/medication-btm";

export const runtime = "nodejs";

// Entsorgung (bei Betäubungsmitteln mit Zweitunterschrift).
export async function POST(request: Request, { params }: { params: Promise<{ stockId: string }> }) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const { stockId } = await params;
    await disposeStock(ctx, stockId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Die Entsorgung konnte nicht gebucht werden.");
  }
}
