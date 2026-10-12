import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { recordFridgeReading } from "@/lib/fridges";

export const runtime = "nodejs";

// Messung erfassen ({ measuredAt, celsius, note }).
export async function POST(request: Request, { params }: { params: Promise<{ fridgeId: string }> }) {
  try {
    const ctx = await apiContext();
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await recordFridgeReading(ctx, (await params).fridgeId, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Die Messung konnte nicht gespeichert werden.");
  }
}
