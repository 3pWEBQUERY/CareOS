import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { deviceOverview, saveDevice } from "@/lib/devices";

export const runtime = "nodejs";

// Geräte und Hilfsmittel der Einrichtung mit Prüfungen.
export async function GET() {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await deviceOverview(ctx));
  } catch (error) {
    return apiErrorResponse(error, "Die Geräte konnten nicht geladen werden.");
  }
}

// Anlegen oder mit { id } ändern.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("quality.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await saveDevice(ctx, body));
  } catch (error) {
    return apiErrorResponse(error, "Das Gerät konnte nicht gespeichert werden.");
  }
}
