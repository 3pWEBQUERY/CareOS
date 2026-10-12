import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { enrollmentAction } from "@/lib/learning-enrollments";

export const runtime = "nodejs";

// { action: "progress", progress } | { action: "withdraw" } | { action: "verify" } | { action: "quiz", answers }
export async function POST(request: Request, { params }: { params: Promise<{ enrollmentId: string }> }) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const result = await enrollmentAction(
      ctx,
      (await params).enrollmentId,
      (await request.json()) as Record<string, unknown>,
    );
    return NextResponse.json(result ?? { ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Anmeldung konnte nicht geändert werden.");
  }
}
