import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { readDeathChecklist, saveDeathChecklist } from "@/lib/end-of-life";

export const runtime = "nodejs";

// Checkliste nach einem Todesfall: Punkte legt die Einrichtung selbst fest (Administration).
export async function GET() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({ items: await readDeathChecklist(ctx) });
  } catch (error) {
    return apiErrorResponse(error, "Die Checkliste konnte nicht geladen werden.");
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ items: await saveDeathChecklist(ctx, body) });
  } catch (error) {
    return apiErrorResponse(error, "Die Checkliste konnte nicht gespeichert werden.");
  }
}
