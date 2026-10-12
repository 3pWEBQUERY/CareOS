import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { careInsights, leadershipInsights, workforceInsights } from "@/lib/insights";
import { residentInsights } from "@/lib/resident-insights";

export const runtime = "nodejs";

const views = {
  care: careInsights,
  leadership: leadershipInsights,
  workforce: workforceInsights,
  residents: residentInsights,
};

export async function GET(request: Request) {
  try {
    const ctx = await apiContext("insights.read");
    if (ctx instanceof NextResponse) return ctx;
    const view = new URL(request.url).searchParams.get("view") ?? "care";
    if (!(view in views)) return NextResponse.json({ error: "Unbekannte Auswertung." }, { status: 400 });
    return NextResponse.json(await views[view as keyof typeof views](ctx));
  } catch (error) {
    return apiErrorResponse(error, "Kennzahlen konnten nicht geladen werden.");
  }
}
