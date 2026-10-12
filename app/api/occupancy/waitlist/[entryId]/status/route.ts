import { NextResponse } from "next/server";
import { apiContext, apiErrorResponse } from "@/lib/api-context";
import { setWaitlistStatus } from "@/lib/occupancy";

export const runtime = "nodejs";

type Context = { params: Promise<{ entryId: string }> };

// Status der Warteliste: wartet, Platz angeboten, zurückgezogen.
export async function POST(request: Request, { params }: Context) {
  try {
    const ctx = await apiContext("residents.write");
    if (ctx instanceof NextResponse) return ctx;
    const { entryId } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    await setWaitlistStatus(ctx, entryId, body);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error, "Status konnte nicht gespeichert werden.");
  }
}
