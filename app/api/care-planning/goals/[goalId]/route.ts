import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { updateGoal } from "@/lib/care-plan-goals";

export const runtime = "nodejs";

type Context = { params: Promise<{ goalId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { goalId } = await params;
    await updateGoal(ctx, goalId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Pflegeziel konnte nicht aktualisiert werden.");
  }
}
