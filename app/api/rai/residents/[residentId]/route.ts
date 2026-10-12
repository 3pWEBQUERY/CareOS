import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { completeKompass, discardKompass, kompassDetail, saveKompassDraft, startKompass } from "@/lib/kompass";

export const runtime = "nodejs";

type Params = { params: Promise<{ residentId: string }> };

// Abklärung mit dem CareOS Kompass: laufender Entwurf, Verlauf, Hinweise aus der Akte.
export async function GET(_request: Request, { params }: Params) {
  try {
    const ctx = await apiContext("rai.manage");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await kompassDetail(ctx, (await params).residentId));
  } catch (error) {
    return apiErrorResponse(error, "Die Abklärung konnte nicht geladen werden.");
  }
}

// { occasion, assessedOn, assessorId } – neue Abklärung beginnen.
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = await apiContext("rai.manage");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json()) as Record<string, unknown>;
    return NextResponse.json(await startKompass(ctx, (await params).residentId, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Die Abklärung konnte nicht begonnen werden.");
  }
}

// { id, patch } – Entwurf speichern; { id, action: "complete" } – abschliessen; { id, action: "discard", reason }.
export async function PUT(request: Request, { params }: Params) {
  try {
    const ctx = await apiContext("rai.manage");
    if (ctx instanceof NextResponse) return ctx;
    const residentId = (await params).residentId;
    const body = (await request.json()) as Record<string, unknown>;
    if (body.action === "complete") return NextResponse.json(await completeKompass(ctx, residentId, body));
    if (body.action === "discard") {
      await discardKompass(ctx, residentId, body);
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(await saveKompassDraft(ctx, residentId, body));
  } catch (error) {
    return apiErrorResponse(error, "Die Abklärung konnte nicht gespeichert werden.");
  }
}
