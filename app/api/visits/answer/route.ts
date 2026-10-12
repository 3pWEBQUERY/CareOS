import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { resolveVisitItem } from "@/lib/visits";

export const runtime = "nodejs";

// Rückmeldung der Ärztin bzw. des Arztes zu einer Frage der Pflege.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await resolveVisitItem(ctx, body.entryId, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Rückmeldung konnte nicht gespeichert werden.");
  }
}
