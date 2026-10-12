import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { activityWeek, createActivity } from "@/lib/activities";

export const runtime = "nodejs";

// Angebote einer Woche (Montag bis Sonntag), optional für einen Wohnbereich.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await activityWeek(ctx, params.get("day"), params.get("careUnitId") || null));
  } catch (error) {
    return apiErrorResponse(error, "Angebote konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await createActivity(ctx, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Angebot konnte nicht geplant werden.");
  }
}
