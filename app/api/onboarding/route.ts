import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { onboardingOverview, startOnboarding } from "@/lib/onboarding";

export const runtime = "nodejs";

// Einarbeitungen (Leitung: alle; sonst die eigenen bzw. die begleiteten) mit Checklisten je Rolle.
export async function GET() {
  try {
    const ctx = await apiContext();
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await onboardingOverview(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Die Einarbeitungen konnten nicht geladen werden.");
  }
}

// Einarbeitung starten ({ userId, mentorId?, startedOn, note? }).
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("team.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await startOnboarding(ctx, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Die Einarbeitung konnte nicht gestartet werden.");
  }
}
