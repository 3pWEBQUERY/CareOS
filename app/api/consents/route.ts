import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { consentOverview } from "@/lib/consents";

export const runtime = "nodejs";

// Übersicht je Wohnbereich zu einem Thema (?topic=Fotos).
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await consentOverview(ctx, new URL(request.url).searchParams.get("topic")));
  } catch (error) {
    return apiErrorResponse(error, "Die Übersicht konnte nicht erstellt werden.");
  }
}
