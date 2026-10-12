import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { updateDeathChecklistItem } from "@/lib/end-of-life";

export const runtime = "nodejs";

// Punkt der Checkliste nach einem Todesfall abhaken oder wieder öffnen ({ done, note? }).
export async function PATCH(request: Request, { params }: { params: Promise<{ itemId: string }> }) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await updateDeathChecklistItem(ctx, (await params).itemId, body));
  } catch (error) {
    return apiErrorResponse(error, "Der Punkt konnte nicht gespeichert werden.");
  }
}
