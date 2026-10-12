import { NextResponse, type NextRequest } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createInvoices, invoiceRun } from "@/lib/invoices";

export const runtime = "nodejs";

// Rechnungslauf eines Monats (?month=YYYY-MM; ohne Angabe der Vormonat).
export async function GET(request: NextRequest) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await invoiceRun(ctx, request.nextUrl.searchParams.get("month")));
  } catch (error) {
    return apiErrorResponse(error, "Die Rechnungen konnten nicht geladen werden.");
  }
}

// { month, residentIds? } – Rechnungen erstellen.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await createInvoices(ctx, (await request.json()) as Record<string, unknown>), {
      status: 201,
    });
  } catch (error) {
    return apiErrorResponse(error, "Die Rechnungen konnten nicht erstellt werden.");
  }
}
