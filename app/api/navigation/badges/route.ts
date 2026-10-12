import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { navigationBadges } from "@/lib/navigation-badges";

export const runtime = "nodejs";

export async function GET() {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await navigationBadges(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Zähler konnten nicht geladen werden.");
  }
}
