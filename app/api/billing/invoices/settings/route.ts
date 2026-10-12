import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { invoiceSettings, saveInvoiceSettings } from "@/lib/invoices";

export const runtime = "nodejs";

// Zahlungsangaben der Einrichtung (Name, Adresse, IBAN, Zahlungsfrist).
export async function GET() {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await invoiceSettings(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Die Zahlungsangaben konnten nicht geladen werden.");
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    await saveInvoiceSettings(ctx, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Die Zahlungsangaben konnten nicht gespeichert werden.");
  }
}
