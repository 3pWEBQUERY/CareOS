import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { markOuting } from "@/lib/outings";

export const runtime = "nodejs";

// Abfahrt bzw. Rückkehr vermerken ({ event: "departed" | "returned" | "undo" }).
export async function POST(request: Request, { params }: { params: Promise<{ appointmentId: string }> }) {
  try {
    const ctx = await apiContext("residents.write");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    await markOuting(ctx, (await params).appointmentId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Der Vermerk konnte nicht gespeichert werden.");
  }
}
