import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { addIntervention } from "@/lib/care-plan-goals";

export const runtime = "nodejs";

type Context = { params: Promise<{ goalId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { goalId } = await params;
    return NextResponse.json(
      { id: await addIntervention(ctx, goalId, (await request.json()) as Record<string, unknown>) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, "Massnahme konnte nicht gespeichert werden.");
  }
}
