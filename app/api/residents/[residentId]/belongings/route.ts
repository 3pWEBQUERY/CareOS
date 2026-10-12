import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { belongingList, createBelonging } from "@/lib/belongings";

export const runtime = "nodejs";
type Context = { params: Promise<{ residentId: string }> };

// Hilfsmittel und persönliche Gegenstände der Person.
export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    return NextResponse.json(await belongingList(ctx, (await params).residentId));
  } catch (error) {
    return apiErrorResponse(error, "Die Gegenstände konnten nicht geladen werden.");
  }
}

// Erfassen ({ kind, name, marking?, location?, note? }).
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    return NextResponse.json(await createBelonging(ctx, (await params).residentId, body), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Der Gegenstand konnte nicht gespeichert werden.");
  }
}
