import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { retireFridge } from "@/lib/fridges";

export const runtime = "nodejs";

// Ausser Betrieb nehmen ({ reason }).
export async function POST(request: Request, { params }: { params: Promise<{ fridgeId: string }> }) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    await retireFridge(ctx, (await params).fridgeId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Der Kühlschrank konnte nicht ausser Betrieb genommen werden.");
  }
}
