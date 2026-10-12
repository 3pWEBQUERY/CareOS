import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { saveWaitlistEntry } from "@/lib/occupancy";

export const runtime = "nodejs";

type Context = { params: Promise<{ entryId: string }> };

// Eintrag der Warteliste ändern.
export async function PATCH(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.write");
    if (ctx instanceof NextResponse) return ctx;
    const { entryId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await saveWaitlistEntry(ctx, entryId, body));
  } catch (error) {
    return apiErrorResponse(error, "Eintrag konnte nicht gespeichert werden.");
  }
}
