import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { adoptEmediplanLine } from "@/lib/emediplan-review";

export const runtime = "nodejs";

// Eine Zeile des eMediplans als Verordnung übernehmen (durch die Fachperson geprüft).
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await adoptEmediplanLine(ctx, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Verordnung konnte nicht übernommen werden.");
  }
}
