import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { markAllRead } from "@/lib/team-news";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({ marked: await markAllRead(ctx, (await request.json()) as Record<string, unknown>) });
  } catch (error) {
    return apiErrorResponse(error, "Beiträge konnten nicht als gelesen markiert werden.");
  }
}
