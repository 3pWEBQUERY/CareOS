import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { cancelPayment } from "@/lib/invoice-payments";

export const runtime = "nodejs";

// { reason } – Zahlung stornieren.
export async function POST(request: Request, { params }: { params: Promise<{ paymentId: string }> }) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    await cancelPayment(ctx, (await params).paymentId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Zahlung konnte nicht storniert werden.");
  }
}
