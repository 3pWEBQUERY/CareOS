import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { createWound, woundsOverview } from "@/lib/wounds";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const includeClosed = new URL(request.url).searchParams.get("closed") === "1";
    return NextResponse.json({
      ...(await woundsOverview(ctx, includeClosed)),
      canWrite: hasPermission(ctx.actor, "documentation.write"),
    });
  } catch (error) {
    return apiErrorResponse(error, "Wunden konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(
      { id: await createWound(ctx, (await request.json()) as Record<string, unknown>) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, "Wunde konnte nicht gespeichert werden.");
  }
}
