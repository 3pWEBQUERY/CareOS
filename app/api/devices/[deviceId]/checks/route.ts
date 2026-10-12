import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { recordDeviceCheck } from "@/lib/devices";

export const runtime = "nodejs";

// Prüfung erfassen ({ checkedOn, result, findings, performedBy, nextDueOn? }).
export async function POST(request: Request, { params }: { params: Promise<{ deviceId: string }> }) {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await recordDeviceCheck(ctx, (await params).deviceId, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Die Prüfung konnte nicht gespeichert werden.");
  }
}
