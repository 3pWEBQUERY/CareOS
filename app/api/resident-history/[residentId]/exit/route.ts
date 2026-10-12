import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { recordExit } from "@/lib/resident-history";

export const runtime = "nodejs";

type Context = { params: Promise<{ residentId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.write");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    const message = await recordExit(ctx, residentId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ message });
  } catch (error) {
    return apiErrorResponse(error, "Austritt konnte nicht erfasst werden.");
  }
}
