import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { recordSummary, updateMasterData } from "@/lib/resident-record";

export const runtime = "nodejs";

type Context = { params: Promise<{ residentId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    return NextResponse.json(await recordSummary(ctx, residentId));
  } catch (error) {
    return apiErrorResponse(error, "Akte konnte nicht geladen werden.");
  }
}

export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.write");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    await updateMasterData(ctx, residentId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json(await recordSummary(ctx, residentId));
  } catch (error) {
    return apiErrorResponse(error, "Stammdaten konnten nicht gespeichert werden.");
  }
}
