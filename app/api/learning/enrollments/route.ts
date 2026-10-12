import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { enroll } from "@/lib/learning-enrollments";

export const runtime = "nodejs";

// { trainingId, sessionId? } – registers the signed-in person.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    await enroll(ctx, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Anmeldung fehlgeschlagen.");
  }
}
