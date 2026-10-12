import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { dismissSetupChecklist, setupChecklist } from "@/lib/setup-checklist";

export const runtime = "nodejs";

// Ersteinrichtung: offene Schritte für die Administration.
export async function GET() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await setupChecklist(ctx), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "Die Ersteinrichtung konnte nicht geladen werden.");
  }
}

// Liste ausblenden ({ dismissed: true }) oder wieder zeigen.
export async function PATCH(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { dismissed?: unknown };
    return NextResponse.json(await dismissSetupChecklist(ctx, body.dismissed === true));
  } catch (error) {
    return apiErrorResponse(error, "Die Ersteinrichtung konnte nicht gespeichert werden.");
  }
}
