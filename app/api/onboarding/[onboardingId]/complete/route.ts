import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { completeOnboarding } from "@/lib/onboarding";

export const runtime = "nodejs";

// Einarbeitung abschliessen (alle Punkte abgezeichnet).
export async function POST(_request: Request, { params }: { params: Promise<{ onboardingId: string }> }) {
  try {
    const ctx = await apiContext("team.manage");
    if (ctx instanceof NextResponse) return ctx;
    await completeOnboarding(ctx, (await params).onboardingId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Einarbeitung konnte nicht abgeschlossen werden.");
  }
}
