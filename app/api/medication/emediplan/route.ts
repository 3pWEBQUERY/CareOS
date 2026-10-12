import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { readEmediplan } from "@/lib/emediplan-review";

export const runtime = "nodejs";

// eMediplan-Code (Inhalt des QR-Codes) für eine Person lesen: Entwurf, nichts wird übernommen.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("medication.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await readEmediplan(ctx, body.residentId, body.code));
  } catch (error) {
    return apiErrorResponse(error, "eMediplan konnte nicht gelesen werden.");
  }
}
