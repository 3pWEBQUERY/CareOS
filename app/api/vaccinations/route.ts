import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { vaccinationOverview } from "@/lib/vaccinations";

export const runtime = "nodejs";

// Übersicht je Wohnbereich (?target=Grippe&since=2026-10-01).
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const params = new URL(request.url).searchParams;
    return NextResponse.json(
      await vaccinationOverview(ctx, { target: params.get("target"), since: params.get("since") }),
    );
  } catch (error) {
    return apiErrorResponse(error, "Die Übersicht konnte nicht erstellt werden.");
  }
}
