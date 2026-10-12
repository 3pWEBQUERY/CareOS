import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { residentVitals } from "@/lib/vitals";

export const runtime = "nodejs";
type Context = { params: Promise<{ residentId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    const search = new URL(request.url).searchParams;
    return NextResponse.json(await residentVitals(ctx, residentId, search.get("metric"), search.get("days")));
  } catch (error) {
    return apiErrorResponse(error, "Messverlauf konnte nicht geladen werden.");
  }
}
