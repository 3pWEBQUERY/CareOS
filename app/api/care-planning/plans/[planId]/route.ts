import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { updatePlan } from "@/lib/care-planning";

export const runtime = "nodejs";

type Context = { params: Promise<{ planId: string }> };

// With `status` the plan is set to review, reactivated or closed; otherwise its data is updated.
export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { planId } = await params;
    await updatePlan(ctx, planId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Pflegeplan konnte nicht aktualisiert werden.");
  }
}
