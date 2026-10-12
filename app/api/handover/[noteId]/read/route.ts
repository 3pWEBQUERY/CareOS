import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { markRead } from "@/lib/handover";

export const runtime = "nodejs";
type Context = { params: Promise<{ noteId: string }> };

export async function POST(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { noteId } = await params;
    await markRead(ctx, noteId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Lesebestätigung konnte nicht gespeichert werden.");
  }
}
