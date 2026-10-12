import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { generateDraft, listDrafts } from "@/lib/ai";

export const runtime = "nodejs";
// Generating a draft can take up to a minute.
export const maxDuration = 120;

export async function GET() {
  try {
    const ctx = await apiContext("ai.use");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({ drafts: await listDrafts(ctx) });
  } catch (error) {
    return apiErrorResponse(error, "KI-Entwürfe konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("ai.use");
    if (ctx instanceof NextResponse) return ctx;
    const draft = await generateDraft(ctx, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ draft }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "KI-Entwurf konnte nicht erstellt werden.");
  }
}
