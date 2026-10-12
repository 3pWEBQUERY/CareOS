import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createFundEntry, fundAccount } from "@/lib/funds";

export const runtime = "nodejs";

// Konto einer Person mit den Buchungen eines Monats (?residentId=…&month=YYYY-MM).
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("funds.manage");
    if (ctx instanceof NextResponse) return ctx;
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await fundAccount(ctx, params.get("residentId"), params.get("month")));
  } catch (error) {
    return apiErrorResponse(error, "Konto konnte nicht geladen werden.");
  }
}

// { residentId, kind, amountCents, bookedOn, purpose, party, receipt } – Buchung erfassen.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("funds.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await createFundEntry(ctx, (await request.json()) as Record<string, unknown>), {
      status: 201,
    });
  } catch (error) {
    return apiErrorResponse(error, "Buchung konnte nicht gespeichert werden.");
  }
}
