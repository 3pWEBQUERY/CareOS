import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { endOutbreak } from "@/lib/hygiene";

export const runtime = "nodejs";

type Context = { params: Promise<{ outbreakId: string }> };

// Ausbruch beenden (Leitung), mit Abschlussnotiz.
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    const { outbreakId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    await endOutbreak(ctx, outbreakId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Ausbruch konnte nicht beendet werden.");
  }
}
