import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { customInstruments, deactivateCustomInstrument, saveCustomInstrument } from "@/lib/assessment-custom";

export const runtime = "nodejs";

// Eigene Einschätzungsinstrumente der Einrichtung (Administration).
export async function GET() {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json({ instruments: await customInstruments(ctx, true) });
  } catch (error) {
    return apiErrorResponse(error, "Instrumente konnten nicht geladen werden.");
  }
}

// Anlegen ({ name, source, reassessDays, items, bands?, description?, category? }) oder mit { id } ändern.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await saveCustomInstrument(ctx, body.id ?? null, body));
  } catch (error) {
    return apiErrorResponse(error, "Instrument konnte nicht gespeichert werden.");
  }
}

// { id } – nicht mehr anbieten; frühere Ergebnisse bleiben.
export async function DELETE(request: Request) {
  try {
    const ctx = await apiContext("administration.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    await deactivateCustomInstrument(ctx, body.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Instrument konnte nicht deaktiviert werden.");
  }
}
