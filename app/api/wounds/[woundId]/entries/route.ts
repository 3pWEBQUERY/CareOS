import { NextResponse } from "next/server";
import { requestIdFrom } from "@/lib/request-receipts";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { addEntry, listEntries } from "@/lib/wounds";

export const runtime = "nodejs";
type Context = { params: Promise<{ woundId: string }> };

export async function GET(_request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.read");
    if (ctx instanceof NextResponse) return ctx;
    const { woundId } = await params;
    return NextResponse.json(await listEntries(ctx, woundId));
  } catch (error) {
    return apiErrorResponse(error, "Wundverlauf konnte nicht geladen werden.");
  }
}

export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("documentation.write");
    if (ctx instanceof NextResponse) return ctx;
    const { woundId } = await params;
    await addEntry(ctx, woundId, (await request.json()) as Record<string, unknown>, requestIdFrom(request));
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error, "Eintrag konnte nicht gespeichert werden.");
  }
}
