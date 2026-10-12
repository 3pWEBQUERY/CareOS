import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { saveSite } from "@/lib/organization";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: Promise<{ siteId: string }> }) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const { siteId } = await params;
    const id = await saveSite(ctx, siteId, (await request.json()) as Record<string, unknown>);
    return NextResponse.json({ id });
  } catch (error) {
    return apiErrorResponse(error, "Standort konnte nicht gespeichert werden.");
  }
}
