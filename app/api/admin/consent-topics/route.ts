import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { readConsentTopics, saveConsentTopics } from "@/lib/consents";

export const runtime = "nodejs";

// Themen der Einwilligungen: legt die Einrichtung selbst fest (Administration).
export async function GET() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({ topics: await readConsentTopics(ctx) });
  } catch (error) {
    return apiErrorResponse(error, "Die Themen konnten nicht geladen werden.");
  }
}

export async function PUT(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json({ topics: await saveConsentTopics(ctx, body) });
  } catch (error) {
    return apiErrorResponse(error, "Die Themen konnten nicht gespeichert werden.");
  }
}
