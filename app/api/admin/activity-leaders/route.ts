import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { activityLeaderSettings, saveActivityLeaders } from "@/lib/activity-leaders";

export const runtime = "nodejs";

// Leitung von Angeboten (Alltagsgestaltung): legt die Administration fest.
export async function GET() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await activityLeaderSettings(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Die Leitung von Angeboten konnte nicht geladen werden.");
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await saveActivityLeaders(ctx, body));
  } catch (error) {
    return apiErrorResponse(error, "Die Leitung von Angeboten konnte nicht gespeichert werden.");
  }
}
