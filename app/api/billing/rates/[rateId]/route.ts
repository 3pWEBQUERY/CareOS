import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { archiveRate, setRatePrice, updateRate } from "@/lib/billing";

export const runtime = "nodejs";

type Params = { params: Promise<{ rateId: string }> };

// Bezeichnung, Kostenträger, Geltung und Regeln bei Abwesenheit ändern.
export async function PATCH(request: Request, { params }: Params) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    await updateRate(ctx, (await params).rateId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Taxe konnte nicht gespeichert werden.");
  }
}

// { action: "price", validFrom, amountCents } oder { action: "archive" }.
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    const { rateId } = await params;
    if (body.action === "archive") await archiveRate(ctx, rateId);
    else await setRatePrice(ctx, rateId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Taxe konnte nicht gespeichert werden.");
  }
}
