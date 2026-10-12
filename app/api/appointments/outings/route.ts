import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { outingDay } from "@/lib/outings";

export const runtime = "nodejs";

// Tagesliste Fahrdienst (?date=YYYY-MM-DD, sonst heute).
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await outingDay(ctx, new URL(request.url).searchParams.get("date")));
  } catch (error) {
    return apiErrorResponse(error, "Die Tagesliste konnte nicht geladen werden.");
  }
}
