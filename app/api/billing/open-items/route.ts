import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { openItems } from "@/lib/invoice-payments";

export const runtime = "nodejs";

// Offene Posten aller Monate.
export async function GET() {
  try {
    const ctx = await apiContext("billing.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await openItems(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Die offenen Posten konnten nicht geladen werden.");
  }
}
