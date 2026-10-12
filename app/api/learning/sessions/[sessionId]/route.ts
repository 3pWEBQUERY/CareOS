import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { cancelSession } from "@/lib/learning-trainings";

export const runtime = "nodejs";

// Cancels a course date; booked people are notified and can choose another date.
export async function POST(_request: Request, { params }: { params: Promise<{ sessionId: string }> }) {
  try {
    const ctx = await apiContext("team.manage");
    if (ctx instanceof NextResponse) return ctx;
    await cancelSession(ctx, (await params).sessionId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Termin konnte nicht abgesagt werden.");
  }
}
