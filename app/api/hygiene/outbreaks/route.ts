import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { declareOutbreak } from "@/lib/hygiene";

export const runtime = "nodejs";

// Ausbruch erfassen (Leitung).
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await declareOutbreak(ctx, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Ausbruch konnte nicht erfasst werden.");
  }
}
