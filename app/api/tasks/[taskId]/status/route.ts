import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { setTaskStatus } from "@/lib/tasks";

export const runtime = "nodejs";

// { status: open|in_progress|escalated|completed|partial|skipped|cancelled, note?, reason? }
export async function POST(request: Request, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    await setTaskStatus(ctx, (await params).taskId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Status konnte nicht gespeichert werden.");
  }
}
