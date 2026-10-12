import { NextResponse } from "next/server";
import { requestIdFrom } from "@/lib/request-receipts";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { createNote, handoverData } from "@/lib/handover";

export const runtime = "nodejs";

// ?period=8|12|24|48|last (since the end of my last shift), ?careUnitId=
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({
      ...(await handoverData(ctx, new URL(request.url).searchParams)),
      canWrite: hasPermission(ctx.actor, "documentation.write"),
    });
  } catch (error) {
    return apiErrorResponse(error, "Übergabe konnte nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(
      { id: await createNote(ctx, (await request.json()) as Record<string, unknown>, requestIdFrom(request)) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, "Übergabepunkt konnte nicht gespeichert werden.");
  }
}
