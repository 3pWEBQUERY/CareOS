import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { updateOutbreak } from "@/lib/hygiene";

export const runtime = "nodejs";

type Context = { params: Promise<{ outbreakId: string }> };

// Massnahmen und Meldung an die Behörde nachtragen.
export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    const { outbreakId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    await updateOutbreak(ctx, outbreakId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Ausbruch konnte nicht gespeichert werden.");
  }
}
