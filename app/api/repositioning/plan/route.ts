import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { endRepositioningPlan, saveRepositioningPlan } from "@/lib/repositioning";

export const runtime = "nodejs";

// { residentId, intervalMinutes, interventionId?, note? } – Plan festlegen oder ersetzen.
export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await saveRepositioningPlan(ctx, body.residentId, body));
  } catch (error) {
    return apiErrorResponse(error, "Lagerungsplan konnte nicht gespeichert werden.");
  }
}

// { residentId, reason } – Plan beenden.
export async function DELETE(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    await endRepositioningPlan(ctx, body.residentId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Lagerungsplan konnte nicht beendet werden.");
  }
}
