import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { setControlled } from "@/lib/medication-btm";

export const runtime = "nodejs";

// Präparat als Betäubungsmittel führen oder die Kennzeichnung aufheben.
export async function PATCH(request: Request, { params }: { params: Promise<{ medicationId: string }> }) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const { medicationId } = await params;
    await setControlled(ctx, medicationId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die BtM-Kennzeichnung konnte nicht geändert werden.");
  }
}
