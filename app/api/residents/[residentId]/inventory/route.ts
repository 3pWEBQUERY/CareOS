import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { belongingInventory } from "@/lib/belongings";

export const runtime = "nodejs";

// Inventarliste der Person (vorhandene Gegenstände) zum Drucken.
export async function GET(_request: Request, { params }: { params: Promise<{ residentId: string }> }) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await belongingInventory(ctx, (await params).residentId));
  } catch (error) {
    return apiErrorResponse(error, "Die Inventarliste konnte nicht erstellt werden.");
  }
}
