import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { rephraseText } from "@/lib/ai";

export const runtime = "nodejs";

// { text, residentId? } – Rohtext (z. B. aus dem Diktat) als Pflegebericht-Entwurf umformulieren.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("ai.use");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json({ draft: await rephraseText(ctx, body) }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Der Text konnte nicht umformuliert werden.");
  }
}
