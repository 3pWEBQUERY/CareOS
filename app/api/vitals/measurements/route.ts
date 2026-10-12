import { NextResponse } from "next/server";
import { requestIdFrom } from "@/lib/request-receipts";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { recordMeasurements } from "@/lib/vitals";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const results = await recordMeasurements(
      ctx,
      (await request.json()) as Record<string, unknown>,
      requestIdFrom(request),
    );
    return NextResponse.json({ results }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Messung konnte nicht gespeichert werden.");
  }
}
