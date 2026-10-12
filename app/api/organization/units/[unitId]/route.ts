import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { saveUnit } from "@/lib/organization";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ unitId: string }> }) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const { unitId } = await params;
    const id = await saveUnit(ctx, unitId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ id });
  } catch (error) {
    return apiErrorResponse(error, "Wohnbereich konnte nicht gespeichert werden.");
  }
}
