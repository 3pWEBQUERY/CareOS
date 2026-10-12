import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { shiftPulse } from "@/lib/shift";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await shiftPulse(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Überblick konnte nicht geladen werden.");
  }
}
