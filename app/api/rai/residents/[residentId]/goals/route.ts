import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { adoptKompassNeed } from "@/lib/kompass";

export const runtime = "nodejs";

type Params = { params: Promise<{ residentId: string }> };

// { assessmentId, domainId, statement, targetDate } – Handlungsbedarf als Ziel in die Pflegeplanung übernehmen.
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await apiContext("rai.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await adoptKompassNeed(ctx, (await params).residentId, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Das Ziel konnte nicht übernommen werden.");
  }
}
