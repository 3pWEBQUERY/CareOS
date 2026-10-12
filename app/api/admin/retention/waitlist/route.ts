import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { deleteWaitlistEntries, waitlistRetentionOverview } from "@/lib/retention";

export const runtime = "nodejs";

// Abgeschlossene Anfragen der Warteliste mit abgelaufener Aufbewahrungsfrist (Administration).
export async function GET() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await waitlistRetentionOverview(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Löschfristen der Warteliste konnten nicht geladen werden.");
  }
}

// { ids } – endgültige Löschung nach Ablauf der Frist.
export async function DELETE(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as { ids?: unknown };
    return NextResponse.json(await deleteWaitlistEntries(ctx, body.ids));
  } catch (error) {
    return apiErrorResponse(error, "Anfragen konnten nicht gelöscht werden.");
  }
}
