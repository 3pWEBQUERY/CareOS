import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { updateAction } from "@/lib/quality";

export const runtime = "nodejs";

type Context = { params: Promise<{ actionId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    const { actionId } = await params;
    await updateAction(ctx, actionId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Massnahme konnte nicht aktualisiert werden.");
  }
}
