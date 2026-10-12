import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { staffThread } from "@/lib/portal-messages";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ threadId: string }> }) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await staffThread(ctx, (await params).threadId));
  } catch (error) {
    return apiErrorResponse(error, "Die Unterhaltung konnte nicht geladen werden.");
  }
}
