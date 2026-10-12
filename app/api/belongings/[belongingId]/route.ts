import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { removeBelonging, updateBelonging } from "@/lib/belongings";

export const runtime = "nodejs";
type Context = { params: Promise<{ belongingId: string }> };

// Ändern (dieselben Felder wie beim Erfassen, dazu { updatedAt } gegen gleichzeitige Änderungen).
export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await updateBelonging(ctx, (await params).belongingId, body));
  } catch (error) {
    return apiErrorResponse(error, "Der Gegenstand konnte nicht gespeichert werden.");
  }
}

// Als nicht mehr vorhanden vermerken ({ reason }).
export async function DELETE(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await removeBelonging(ctx, (await params).belongingId, body));
  } catch (error) {
    return apiErrorResponse(error, "Der Gegenstand konnte nicht vermerkt werden.");
  }
}
