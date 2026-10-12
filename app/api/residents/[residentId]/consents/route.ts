import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { consentList, recordConsent } from "@/lib/consents";

export const runtime = "nodejs";
type Context = { params: Promise<{ residentId: string }> };

// Einwilligungen und Freigaben der Person (Stand je Thema und Verlauf).
export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await consentList(ctx, (await params).residentId));
  } catch (error) {
    return apiErrorResponse(error, "Die Einwilligungen konnten nicht geladen werden.");
  }
}

// Entscheid erfassen ({ topic, decision, decidedBy, decidedOn, note? }).
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await recordConsent(ctx, (await params).residentId, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Der Entscheid konnte nicht gespeichert werden.");
  }
}
