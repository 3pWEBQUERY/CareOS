import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { checkIn } from "@/lib/shift-check-in";

export const runtime = "nodejs";

// { assignmentId } for a planned shift, or { careUnitId, shiftType, date }; plus checklist, handoverStatus, note.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const id = await checkIn(ctx, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ id }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Dienst konnte nicht gestartet werden.");
  }
}
