import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createRepositioningEntry, repositioningView } from "@/lib/repositioning";
import { requestIdFrom } from "@/lib/request-receipts";

export const runtime = "nodejs";

// Lagerungsplan und Positionswechsel einer Person (?residentId=…&hours=24|72|168).
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await repositioningView(ctx, params.get("residentId"), params.get("hours")));
  } catch (error) {
    return apiErrorResponse(error, "Lagerungsprotokoll konnte nicht geladen werden.");
  }
}

// Positionswechsel erfassen (auch aus der Offline-Warteschlange).
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await createRepositioningEntry(ctx, body, requestIdFrom(request)), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Positionswechsel konnte nicht gespeichert werden.");
  }
}
