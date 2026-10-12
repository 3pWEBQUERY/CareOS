import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { draftKompassSummary } from "@/lib/ai";
import { forbidden, hasPermission } from "@/lib/server-data";

export const runtime = "nodejs";

type Params = { params: Promise<{ residentId: string }> };

// Entwurf der CareOS KI für das Gesamtbild der laufenden Abklärung (nur Vorschlag, die Fachperson entscheidet).
export async function POST(_request: Request, { params }: Params) {
  try {
    const ctx = await apiContext("rai.manage");
    if (ctx instanceof NextResponse) return ctx;
    if (!hasPermission(ctx.actor, "ai.use")) return forbidden();
    return NextResponse.json({ draft: await draftKompassSummary(ctx, (await params).residentId) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Der Entwurf konnte nicht erstellt werden.");
  }
}
