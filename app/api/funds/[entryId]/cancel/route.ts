import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { cancelFundEntry } from "@/lib/funds";

export const runtime = "nodejs";
type Context = { params: Promise<{ entryId: string }> };

// { reason } – Buchung stornieren (bleibt sichtbar).
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("funds.manage");
    if (ctx instanceof NextResponse) return ctx;
    await cancelFundEntry(ctx, (await params).entryId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Buchung konnte nicht storniert werden.");
  }
}
