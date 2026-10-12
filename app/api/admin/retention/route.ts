import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { deleteResidentRecord, retentionOverview } from "@/lib/retention";

export const runtime = "nodejs";

// Akten mit abgelaufener Aufbewahrungsfrist (Administration).
export async function GET() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await retentionOverview(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Löschfristen konnten nicht geladen werden.");
  }
}

// { residentId, confirmation } – endgültige Löschung nach Ablauf der Frist.
export async function DELETE(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as { residentId?: unknown; confirmation?: unknown };
    await deleteResidentRecord(ctx, body.residentId, body.confirmation);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Akte konnte nicht gelöscht werden.");
  }
}
