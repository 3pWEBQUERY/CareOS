import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { btmBook } from "@/lib/medication-btm";

export const runtime = "nodejs";

// BtM-Buch einer Bestandsposition.
export async function GET(_request: Request, { params }: { params: Promise<{ stockId: string }> }) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { stockId } = await params;
    return NextResponse.json(await btmBook(ctx, stockId), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiErrorResponse(error, "Das BtM-Buch konnte nicht geladen werden.");
  }
}
