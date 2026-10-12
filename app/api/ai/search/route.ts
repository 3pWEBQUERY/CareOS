import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { aiSearch } from "@/lib/ai-search";

export const runtime = "nodejs";
export const maxDuration = 120;

// Such-Assistenz: Frage in Alltagssprache, Antwort nur aus den Daten mit Verweisen auf die Akten.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("ai.use");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await aiSearch(ctx, (await request.json()) as Record<string, unknown>));
  } catch (error) {
    return apiErrorResponse(error, "Die Frage konnte nicht beantwortet werden.");
  }
}
