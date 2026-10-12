import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { saveFeedbackResponseDays } from "@/lib/feedback";

export const runtime = "nodejs";

// Antwortfrist der Einrichtung in Tagen ({ days }; leer = keine Frist).
export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ days: await saveFeedbackResponseDays(ctx, body) });
  } catch (error) {
    return apiErrorResponse(error, "Die Frist konnte nicht gespeichert werden.");
  }
}
