import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { exportResidentData } from "@/lib/data-export";

export const runtime = "nodejs";
type Context = { params: Promise<{ residentId: string }> };

// Auskunft: alle Daten der Akte ({ requestedBy, format: "print" | "json" }); nur Administration, wird protokolliert.
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await exportResidentData(ctx, (await params).residentId, body), {
      headers: { "Cache-Control": "no-store, private" },
    });
  } catch (error) {
    return apiErrorResponse(error, "Die Auskunft konnte nicht erstellt werden.");
  }
}
