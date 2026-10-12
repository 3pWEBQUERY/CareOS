import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { feedbackOverview, recordFeedback } from "@/lib/feedback";

export const runtime = "nodejs";

// Rückmeldungen und Beschwerden mit Auswertung (?year=JJJJ).
export async function GET(request: Request) {
  try {
    const ctx = await apiContext();
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await feedbackOverview(ctx, new URL(request.url).searchParams.get("year")));
  } catch (error) {
    return apiErrorResponse(error, "Die Rückmeldungen konnten nicht geladen werden.");
  }
}

// Rückmeldung erfassen.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext();
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await recordFeedback(ctx, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Die Rückmeldung konnte nicht gespeichert werden.");
  }
}
