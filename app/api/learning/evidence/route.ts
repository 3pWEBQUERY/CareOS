import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { recordEvidence } from "@/lib/learning-enrollments";

export const runtime = "nodejs";

// multipart/form-data: trainingId, userId?, completedOn, note?, certificate?
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    await recordEvidence(ctx, await request.formData());
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Nachweis konnte nicht gespeichert werden.");
  }
}
