import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createServiceRecord, serviceDay } from "@/lib/services";

export const runtime = "nodejs";

// Leistungen einer Person an einem Tag, mit Vorschlägen aus Aufgaben und Massnahmen.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await serviceDay(ctx, params.get("residentId"), params.get("day")));
  } catch (error) {
    return apiErrorResponse(error, "Leistungen konnten nicht geladen werden.");
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await createServiceRecord(ctx, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Leistung konnte nicht gespeichert werden.");
  }
}
