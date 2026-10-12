import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { documentationStats } from "@/lib/documentation";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await documentationStats(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Kennzahlen konnten nicht geladen werden.");
  }
}
