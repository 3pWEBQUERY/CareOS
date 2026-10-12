import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { postAction } from "@/lib/team-news";

export const runtime = "nodejs";

// { action: "read" | "ack" | "edit" | "pin" | "unpin" | "archive", ... }
export async function POST(request: Request, { params }: { params: Promise<{ postId: string }> }) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    await postAction(ctx, (await params).postId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Beitrag konnte nicht geändert werden.");
  }
}
