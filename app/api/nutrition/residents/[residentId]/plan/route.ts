import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { savePlan } from "@/lib/nutrition";

export const runtime = "nodejs";
type Context = { params: Promise<{ residentId: string }> };

export async function PUT(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    return NextResponse.json({
      id: await savePlan(ctx, residentId, (await request.json()) as Record<string, unknown>),
    });
  } catch (error) {
    return apiErrorResponse(error, "Ernährungsplan konnte nicht gespeichert werden.");
  }
}
