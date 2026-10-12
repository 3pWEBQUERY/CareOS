import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { recentEntries } from "@/lib/wounds";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({
      ...(await recentEntries(ctx, new URL(request.url).searchParams.get("days"))),
      canWrite: hasPermission(ctx.actor, "documentation.write"),
    });
  } catch (error) {
    return apiErrorResponse(error, "Wunddokumentation konnte nicht geladen werden.");
  }
}
