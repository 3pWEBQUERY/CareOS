import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { portalAccessLog } from "@/lib/portal-admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const accountId = new URL(request.url).searchParams.get("accountId");
    return NextResponse.json({ entries: await portalAccessLog(ctx, accountId) });
  } catch (error) {
    return apiErrorResponse(error, "Die Zugriffe konnten nicht geladen werden.");
  }
}
