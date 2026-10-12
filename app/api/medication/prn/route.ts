import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { administerPrn } from "@/lib/medication-round";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("medication.administer");
    if (ctx instanceof NextResponse) return ctx;
    await administerPrn(ctx, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Reservegabe konnte nicht dokumentiert werden.");
  }
}
