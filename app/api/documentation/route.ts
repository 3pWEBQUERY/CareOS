import { NextResponse } from "next/server";
import { requestIdFrom } from "@/lib/request-receipts";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { hasPermission } from "@/lib/server-data";
import { createEntry, listEntries } from "@/lib/documentation";

export const runtime = "nodejs";

// Filters: residentId, category, importance, days (1/7/30/90), q.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({
      entries: await listEntries(ctx, new URL(request.url).searchParams),
      canWrite: hasPermission(ctx.actor, "documentation.write"),
    });
  } catch (error) {
    return apiErrorResponse(error, "Dokumentation konnte nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(
      { id: await createEntry(ctx, (await request.json()) as Record<string, unknown>, requestIdFrom(request)) },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error, "Dokumentation konnte nicht gespeichert werden.");
  }
}
