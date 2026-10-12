import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { updateFeedback } from "@/lib/feedback";

export const runtime = "nodejs";

// Bearbeiten, beantworten, abschliessen oder wieder öffnen ({ action, … }).
export async function PATCH(request: Request, { params }: { params: Promise<{ feedbackId: string }> }) {
  try {
    const ctx = await apiContext();
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    await updateFeedback(ctx, (await params).feedbackId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Rückmeldung konnte nicht gespeichert werden.");
  }
}
