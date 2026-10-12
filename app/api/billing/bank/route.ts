import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { bankImportBook, bankImportPreview } from "@/lib/invoice-payments";

export const runtime = "nodejs";

// { xml, book? } – Bankdatei (camt.054/053) zuordnen; mit book: true die zugeordneten Gutschriften verbuchen.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    if (body.book === true) return NextResponse.json(await bankImportBook(ctx, body));
    return NextResponse.json({ booked: 0, lines: await bankImportPreview(ctx, body) });
  } catch (error) {
    return apiErrorResponse(error, "Die Bankdatei konnte nicht verarbeitet werden.");
  }
}
