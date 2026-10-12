import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { evacuationList } from "@/lib/evacuation";

export const runtime = "nodejs";

// Evakuierungs- und Notfallliste (?unit=<Wohnbereich>, ohne: alle Wohnbereiche).
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const unit = new URL(request.url).searchParams.get("unit");
    return NextResponse.json(await evacuationList(ctx, unit), { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    return apiErrorResponse(error, "Die Evakuierungsliste konnte nicht erstellt werden.");
  }
}
