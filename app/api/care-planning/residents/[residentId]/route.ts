import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { residentPlan } from "@/lib/care-planning";

export const runtime = "nodejs";

type Context = { params: Promise<{ residentId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    return NextResponse.json(await residentPlan(ctx, residentId));
  } catch (error) {
    return apiErrorResponse(error, "Pflegeplan konnte nicht geladen werden.");
  }
}
