import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { signOnboardingStep } from "@/lib/onboarding";

export const runtime = "nodejs";

// Punkt abzeichnen ({ done: true, note? }) oder zurücknehmen ({ done: false }).
export async function PATCH(request: Request, { params }: { params: Promise<{ stepId: string }> }) {
  try {
    const ctx = await apiContext();
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    await signOnboardingStep(ctx, (await params).stepId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Der Punkt konnte nicht gespeichert werden.");
  }
}
