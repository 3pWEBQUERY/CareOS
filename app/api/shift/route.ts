import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { shiftOverview } from "@/lib/shift-overview";

export const runtime = "nodejs";

// ?range=shift|day, ?careUnitId=<id>|all
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await shiftOverview(ctx, new URL(request.url).searchParams));
  } catch (error) {
    return apiErrorResponse(error, "Dienst konnte nicht geladen werden.");
  }
}
