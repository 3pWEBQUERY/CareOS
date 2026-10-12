import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { addGoal } from "@/lib/care-plan-goals";

export const runtime = "nodejs";

type Context = { params: Promise<{ planId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { planId } = await params;
    return NextResponse.json(
      { id: await addGoal(ctx, planId, (await request.json()) as Record<string, unknown>) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, "Pflegeziel konnte nicht gespeichert werden.");
  }
}
