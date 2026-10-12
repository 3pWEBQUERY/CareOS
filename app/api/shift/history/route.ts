import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { shiftHistory } from "@/lib/shift";

export const runtime = "nodejs";

// ?days=30|90|180|365
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await shiftHistory(ctx, new URL(request.url).searchParams));
  } catch (error) {
    return apiErrorResponse(error, "Schichtverlauf konnte nicht geladen werden.");
  }
}
