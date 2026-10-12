import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { confirmAdmission } from "@/lib/occupancy";

export const runtime = "nodejs";

type Context = { params: Promise<{ residentId: string }> };

// Geplanten Eintritt bestätigen.
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.write");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    await confirmAdmission(ctx, residentId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Eintritt konnte nicht bestätigt werden.");
  }
}
