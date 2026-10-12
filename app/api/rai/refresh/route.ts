import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { refreshRaiDue } from "@/lib/rai";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("rai.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await refreshRaiDue(ctx, (await request.json()) as Record<string, unknown>));
  } catch (error) {
    return apiErrorResponse(error, "Die Fälligkeiten konnten nicht aktualisiert werden.");
  }
}
