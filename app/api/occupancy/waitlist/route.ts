import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { saveWaitlistEntry } from "@/lib/occupancy";

export const runtime = "nodejs";

// Eintrag auf die Warteliste setzen.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("residents.write");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await saveWaitlistEntry(ctx, null, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Eintrag konnte nicht gespeichert werden.");
  }
}
