import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { createEliminationEntry, eliminationView } from "@/lib/elimination";
import { requestIdFrom } from "@/lib/request-receipts";

export const runtime = "nodejs";

// Ausscheidungsprotokoll einer Person (?residentId=…&days=3|7|14).
export async function GET(request: Request) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const params = new URL(request.url).searchParams;
    return NextResponse.json(await eliminationView(ctx, params.get("residentId"), params.get("days")));
  } catch (error) {
    return apiErrorResponse(error, "Ausscheidungsprotokoll konnte nicht geladen werden.");
  }
}

// Eintrag erfassen (auch aus der Offline-Warteschlange).
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await createEliminationEntry(ctx, body, requestIdFrom(request)), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Eintrag konnte nicht gespeichert werden.");
  }
}
