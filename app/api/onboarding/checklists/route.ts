import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { saveOnboardingChecklist } from "@/lib/onboarding";

export const runtime = "nodejs";

// Checkliste einer Rolle festlegen ({ role, items }; role "" = für alle Rollen).
export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("team.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ items: await saveOnboardingChecklist(ctx, body) });
  } catch (error) {
    return apiErrorResponse(error, "Die Checkliste konnte nicht gespeichert werden.");
  }
}
