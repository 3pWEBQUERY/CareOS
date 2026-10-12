import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { correctStock } from "@/lib/medication-stock";

export const runtime = "nodejs";
type Context = { params: Promise<{ stockId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const { stockId } = await params;
    await correctStock(ctx, stockId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Bestand konnte nicht korrigiert werden.");
  }
}
