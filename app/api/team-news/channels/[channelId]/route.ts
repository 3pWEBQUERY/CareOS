import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { channelAction } from "@/lib/team-news";

export const runtime = "nodejs";

// { action: "join" | "leave" | "archive" }
export async function POST(request: Request, { params }: { params: Promise<{ channelId: string }> }) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    await channelAction(ctx, (await params).channelId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Kanal konnte nicht geändert werden.");
  }
}
