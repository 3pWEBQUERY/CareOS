import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { residentNutrition } from "@/lib/nutrition";

export const runtime = "nodejs";
type Context = { params: Promise<{ residentId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    return NextResponse.json(await residentNutrition(ctx, residentId, new URL(request.url).searchParams.get("date")));
  } catch (error) {
    return apiErrorResponse(error, "Ernährungsdaten konnten nicht geladen werden.");
  }
}
