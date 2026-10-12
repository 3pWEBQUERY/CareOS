import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { countStock } from "@/lib/medication-btm";

export const runtime = "nodejs";

// Bestandskontrolle mit Zweitunterschrift.
export async function POST(request: Request, { params }: { params: Promise<{ stockId: string }> }) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const { stockId } = await params;
    return NextResponse.json(await countStock(ctx, stockId, (await request.json()) as Record<string, unknown>), {
      status: 201,
    });
  } catch (error) {
    return apiErrorResponse(error, "Die Bestandskontrolle konnte nicht gespeichert werden.");
  }
}
