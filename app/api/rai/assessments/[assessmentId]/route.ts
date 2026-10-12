import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { kompassReport } from "@/lib/kompass";

export const runtime = "nodejs";

type Params = { params: Promise<{ assessmentId: string }> };

// Bericht einer abgeschlossenen Abklärung mit dem Kompass (mit der vorherigen zum Vergleich).
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await apiContext("rai.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await kompassReport(ctx, (await params).assessmentId));
  } catch (error) {
    return apiErrorResponse(error, "Der Bericht konnte nicht geladen werden.");
  }
}
