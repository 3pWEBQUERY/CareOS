import { NextResponse, type NextRequest } from "next/server";
import { toCsv, type CsvValue } from "@/lib/roster/csv";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { invoiceJournal, payerStatement } from "@/lib/invoice-payments";

export const runtime = "nodejs";

// CSV für die Buchhaltung: ?kind=journal (Rechnungen des Monats) oder ?kind=payers (Anteile der Kostenträger).
export async function GET(request: NextRequest) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    const params = request.nextUrl.searchParams;
    const month = params.get("month");
    const kind = params.get("kind") === "payers" ? "payers" : "journal";
    const lines = (
      kind === "payers" ? await payerStatement(ctx, month) : await invoiceJournal(ctx, month)
    ) as CsvValue[][];
    const name = kind === "payers" ? "kostentraeger" : "rechnungsjournal";
    return new NextResponse(toCsv(lines), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="${name}-${month}.csv"`,
      },
    });
  } catch (error) {
    return apiErrorResponse(error, "Der Export konnte nicht erstellt werden.");
  }
}
