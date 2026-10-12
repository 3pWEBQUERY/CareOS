import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { transferSheet } from "@/lib/resident-transfer";

export const runtime = "nodejs";

// Überleitungsbogen einer Bewohnerakte (Druckansicht, z. B. für eine Spitaleinweisung).
export async function GET(_request: Request, { params }: { params: Promise<{ residentId: string }> }) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { residentId } = await params;
    return NextResponse.json(await transferSheet(ctx, residentId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "Der Überleitungsbogen konnte nicht erstellt werden.");
  }
}
