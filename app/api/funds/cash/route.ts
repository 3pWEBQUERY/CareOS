import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createFundCount, fundCash } from "@/lib/funds";

export const runtime = "nodejs";

// Kasse: Guthaben aller Personen und die letzten Kassenkontrollen.
export async function GET() {
  try {
    const ctx = await apiContext("funds.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await fundCash(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Kasse konnte nicht geladen werden.");
  }
}

// { countedCents, witness, note } – Kassenkontrolle erfassen.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("funds.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await createFundCount(ctx, (await request.json()) as Record<string, unknown>), {
      status: 201,
    });
  } catch (error) {
    return apiErrorResponse(error, "Kassenkontrolle konnte nicht gespeichert werden.");
  }
}
