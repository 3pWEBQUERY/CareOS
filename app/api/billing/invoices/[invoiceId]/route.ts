import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { cancelInvoice, invoiceDetail } from "@/lib/invoices";
import { addPayment } from "@/lib/invoice-payments";

export const runtime = "nodejs";

type Params = { params: Promise<{ invoiceId: string }> };

// Rechnung mit Zahlteil (SVG) zum Drucken.
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await invoiceDetail(ctx, (await params).invoiceId));
  } catch (error) {
    return apiErrorResponse(error, "Die Rechnung konnte nicht geladen werden.");
  }
}

// { reason } – Rechnung stornieren; { action: "payment", paidOn, amountCents, note } – Zahlung erfassen.
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    const { invoiceId } = await params;
    if (body.action === "payment") return NextResponse.json(await addPayment(ctx, invoiceId, body), { status: 201 });
    await cancelInvoice(ctx, invoiceId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Änderung an der Rechnung konnte nicht gespeichert werden.");
  }
}
