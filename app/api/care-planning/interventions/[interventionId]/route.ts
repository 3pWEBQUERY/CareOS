import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { updateIntervention } from "@/lib/care-plan-goals";

export const runtime = "nodejs";

type Context = { params: Promise<{ interventionId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { interventionId } = await params;
    await updateIntervention(ctx, interventionId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Massnahme konnte nicht aktualisiert werden.");
  }
}
