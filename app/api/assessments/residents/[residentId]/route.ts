import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { residentHistory } from "@/lib/assessments";

export const runtime = "nodejs";
type Context = { params: Promise<{ residentId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    return NextResponse.json({
      results: await residentHistory(ctx, residentId, new URL(request.url).searchParams.get("instrument")),
    });
  } catch (error) {
    return apiErrorResponse(error, "Verlauf konnte nicht geladen werden.");
  }
}
